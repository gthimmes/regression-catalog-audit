import type { AreaConfig, Config } from "../config/schema.js";
import type { TestinyCase } from "../testiny/client.js";
import {
  type AreaReport,
  type Finding,
  type Severity,
  maxSeverity,
  severityAtLeast,
} from "../types.js";
import {
  type AreaChurn,
  type OverlapWarning,
  type UnmappedChurn,
  churnScoreSince,
} from "./correlate.js";
import { type ReferenceExists, detectOrphans } from "./orphans.js";

/**
 * Finding generation + severity assignment. The finding-type table in CLAUDE.md
 * is the source of truth; this module implements it.
 */

export interface AreaInput {
  area: AreaConfig;
  churn: AreaChurn;
  /** False when the configured folder could not be resolved. */
  folderFound: boolean;
  cases: TestinyCase[];
}

export interface GenerateFindingsInput {
  areas: AreaInput[];
  overlaps: OverlapWarning[];
  unmapped: UnmappedChurn[];
  thresholds: Config["thresholds"];
  /** Injected existence check for orphan detection (fs-backed in the command). */
  referenceExists: ReferenceExists;
}

export interface GenerateFindingsResult {
  findings: Finding[];
  areaReports: AreaReport[];
}

/** Is a single case stale? (area accrued >= staleChurnScore since it was updated) */
export function isCaseStale(
  churn: AreaChurn,
  testCase: TestinyCase,
  staleChurnScore: number,
): boolean {
  const stamp = testCase.modifiedAt ?? testCase.createdAt;
  if (!stamp) return false;
  const since = new Date(stamp);
  if (Number.isNaN(since.getTime())) return false;
  return churnScoreSince(churn, since) >= staleChurnScore;
}

export function generateFindings(input: GenerateFindingsInput): GenerateFindingsResult {
  const { thresholds } = input;
  const findings: Finding[] = [];
  const areaReports: AreaReport[] = [];

  for (const { area, churn, folderFound, cases } of input.areas) {
    const areaFindings: Finding[] = [];

    let totalCases = cases.length;
    let staleCases = 0;
    let healthyCases = 0;

    if (!folderFound) {
      areaFindings.push({
        type: "missing-catalog",
        severity: "high",
        area: area.name,
        message: `Testiny folder "${area.testiny.folder}" for area "${area.name}" could not be found`,
        evidence: { folder: area.testiny.folder },
      });
      totalCases = 0;
    } else if (cases.length === 0) {
      areaFindings.push({
        type: "missing-catalog",
        severity: "high",
        area: area.name,
        message: `Testiny folder "${area.testiny.folder}" for area "${area.name}" contains zero test cases`,
        evidence: { folder: area.testiny.folder },
      });
    } else {
      // Per-case staleness.
      const staleList: TestinyCase[] = [];
      for (const c of cases) {
        if (isCaseStale(churn, c, thresholds.staleChurnScore)) {
          staleList.push(c);
        }
      }
      staleCases = staleList.length;
      healthyCases = totalCases - staleCases;

      // stale-case (low) — one per stale case.
      for (const c of staleList) {
        areaFindings.push({
          type: "stale-case",
          severity: "low",
          area: area.name,
          message: `Case #${c.id} "${c.title}" is stale: area accrued ≥ ${thresholds.staleChurnScore} churn since it was last updated`,
          evidence: { caseId: c.id, title: c.title, lastUpdated: c.modifiedAt ?? c.createdAt },
        });
      }

      // stale-catalog (medium; high if ≥80%).
      const staleRatio = totalCases > 0 ? staleCases / totalCases : 0;
      if (staleRatio >= 0.5) {
        areaFindings.push({
          type: "stale-catalog",
          severity: staleRatio >= 0.8 ? "high" : "medium",
          area: area.name,
          message: `${Math.round(staleRatio * 100)}% of "${area.name}" cases are stale (${staleCases}/${totalCases})`,
          evidence: { staleCases, totalCases, staleRatio: round2(staleRatio) },
        });
      }

      // coverage-gap (high).
      if (churn.churnScore >= thresholds.gapChurnScore && healthyCases < area.minCases) {
        areaFindings.push({
          type: "coverage-gap",
          severity: "high",
          area: area.name,
          message: `High-churn area "${area.name}" (score ${churn.churnScore}) has only ${healthyCases} healthy case(s), below the minimum of ${area.minCases}`,
          evidence: {
            churnScore: churn.churnScore,
            healthyCases,
            minCases: area.minCases,
            gapChurnScore: thresholds.gapChurnScore,
          },
        });
      }

      // orphaned-case (medium).
      const orphanFindings = detectOrphans(cases, input.referenceExists).map((f) => ({
        ...f,
        area: area.name,
      }));
      areaFindings.push(...orphanFindings);
    }

    const worstSeverity = areaFindings.reduce<Severity | null>(
      (worst, f) => (worst === null ? f.severity : maxSeverity(worst, f.severity)),
      null,
    );

    areaReports.push({
      name: area.name,
      team: area.team,
      churnScore: churn.churnScore,
      commits: round2(churn.commits),
      filesChanged: churn.filesChanged,
      linesDelta: Math.round(churn.linesDelta),
      lastChangedAt: churn.lastChangedAt ? churn.lastChangedAt.toISOString() : null,
      folderFound,
      totalCases,
      healthyCases,
      staleCases,
      minCases: area.minCases,
      findingsCount: areaFindings.length,
      worstSeverity,
    });

    findings.push(...areaFindings);
  }

  // overlapping-areas (warning) — never fails the audit.
  for (const overlap of input.overlaps) {
    findings.push({
      type: "overlapping-areas",
      severity: "warning",
      message: `Path "${overlap.path}" is claimed by multiple areas: ${overlap.areas.join(", ")}`,
      evidence: { path: overlap.path, areas: overlap.areas },
    });
  }

  // unmapped-churn (medium).
  for (const u of input.unmapped) {
    findings.push({
      type: "unmapped-churn",
      severity: "medium",
      message: `Changed path "${u.path}" (${u.commits} commits) maps to no configured area`,
      evidence: { path: u.path, commits: u.commits },
    });
  }

  findings.sort(bySeverityThenType);
  return { findings, areaReports };
}

/** Does the run fail per the failOn threshold? warning never fails. */
export function auditFailed(findings: Finding[], failOn: Config["thresholds"]["failOn"]): boolean {
  if (failOn === "never") return false;
  return findings.some(
    (f) => f.severity !== "warning" && severityAtLeast(f.severity, failOn),
  );
}

function bySeverityThenType(a: Finding, b: Finding): number {
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1, warning: 0 };
  if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity];
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  return (a.area ?? "").localeCompare(b.area ?? "");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
