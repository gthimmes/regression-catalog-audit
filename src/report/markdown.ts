import type { AreaReport, Finding, RunInfo, Severity } from "../types.js";

/**
 * Human-readable Markdown report. No HTML — suitable for pasting into
 * Slack/Notion. Deterministic given its inputs (date comes from runInfo).
 */

const STALE_CASE_DISPLAY_CAP = 20;

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  warning: "WARN",
};

export function buildMarkdownReport(
  runInfo: RunInfo,
  areas: AreaReport[],
  findings: Finding[],
): string {
  const lines: string[] = [];

  lines.push("# Regression Catalog Audit", "");
  lines.push(`- **Repository:** ${runInfo.repo}`);
  lines.push(`- **Branch:** ${runInfo.branch}`);
  lines.push(`- **Window:** ${runInfo.windowDays} days`);
  lines.push(`- **Generated:** ${runInfo.generatedAt}`);
  lines.push(`- **AI analysis:** ${runInfo.aiEnabled ? "enabled" : "disabled"}`);
  lines.push(`- **Status:** ${runInfo.status === "PASS" ? "✅ PASS" : "❌ FAIL"}`);
  lines.push("");

  // Per-area summary table.
  lines.push("## Areas", "");
  lines.push(
    "| Area | Team | Churn | Cases | Healthy | Stale | Findings | Worst |",
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const a of areas) {
    const worst = a.worstSeverity ? SEVERITY_LABEL[a.worstSeverity] : "—";
    const casesCell = a.folderFound ? String(a.totalCases) : "n/a";
    lines.push(
      `| ${a.name} | ${a.team} | ${a.churnScore} | ${casesCell} | ${a.healthyCases} | ${a.staleCases} | ${a.findingsCount} | ${worst} |`,
    );
  }
  lines.push("");

  // Findings grouped by area, ordered by severity.
  lines.push("## Findings", "");

  const totalFindings = findings.length;
  if (totalFindings === 0) {
    lines.push("_No findings. Catalogs look healthy for this window._", "");
    return `${lines.join("\n")}\n`;
  }

  for (const a of areas) {
    const areaFindings = findings.filter((f) => f.area === a.name);
    if (areaFindings.length === 0) continue;
    lines.push(`### ${a.name} (${a.team})`, "");
    renderFindingGroup(lines, areaFindings);
    lines.push("");
  }

  const globalFindings = findings.filter((f) => f.area === undefined);
  if (globalFindings.length > 0) {
    lines.push("### Repository-wide", "");
    renderFindingGroup(lines, globalFindings);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderFindingGroup(lines: string[], findings: Finding[]): void {
  const ordered = [...findings].sort(bySeverity);

  // Cap stale-case output per group.
  let staleShown = 0;
  let staleSuppressed = 0;

  for (const f of ordered) {
    if (f.type === "stale-case") {
      if (staleShown >= STALE_CASE_DISPLAY_CAP) {
        staleSuppressed += 1;
        continue;
      }
      staleShown += 1;
    }
    lines.push(`- **[${SEVERITY_LABEL[f.severity]}] ${f.type}** — ${f.message}`);
    if (f.ai && !f.ai.unavailable) {
      if (typeof f.ai.rating === "number") {
        lines.push(`  - _AI plausible-coverage rating:_ ${f.ai.rating}/100`);
      }
      if (f.ai.suggestions && f.ai.suggestions.length > 0) {
        lines.push("  - _AI suggested regression cases:_");
        for (const s of f.ai.suggestions) lines.push(`    - ${s}`);
      }
    } else if (f.ai?.unavailable) {
      lines.push("  - _AI analysis unavailable._");
    }
  }

  if (staleSuppressed > 0) {
    lines.push(`- _…and ${staleSuppressed} more stale case(s) not shown._`);
  }
}

function bySeverity(a: Finding, b: Finding): number {
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1, warning: 0 };
  if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity];
  return a.type.localeCompare(b.type);
}
