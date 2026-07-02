import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AiClient } from "../ai/client.js";
import { correlateChurn } from "../audit/correlate.js";
import { auditFailed, generateFindings } from "../audit/findings.js";
import type { Reference } from "../audit/orphans.js";
import { currentBranch, getCommits, listTrackedFiles } from "../churn/gitlog.js";
import { loadConfig } from "../config/load.js";
import type { AreaConfig, FailOn } from "../config/schema.js";
import { CredentialError, EXIT_AUDIT_FAILED, EXIT_OK, RuntimeError } from "../errors.js";
import { buildMarkdownReport } from "../report/markdown.js";
import { buildJsonReport, renderJsonReport } from "../report/json.js";
import { TestinyClient, type TestinyCase } from "../testiny/client.js";
import { getCasesForFolder, resolveFolder, resolveProject } from "../testiny/resolve.js";
import type { AreaReport, Finding, RunInfo } from "../types.js";
import { type Logger, makeLogger } from "../output.js";

const UNMAPPED_NOISE_FLOOR = 3;
const AI_SUBJECT_LIMIT = 30;

export interface AuditOptions {
  config: string;
  area?: string;
  window?: number;
  format: "md" | "json" | "both";
  out?: string;
  ai: boolean;
  failOn?: FailOn;
  verbose: boolean;
}

export async function runAudit(opts: AuditOptions): Promise<number> {
  const log = makeLogger(opts.verbose);
  const config = loadConfig(opts.config);

  const windowDays = opts.window ?? config.churn.windowDays;
  const failOn: FailOn = opts.failOn ?? config.thresholds.failOn;
  const thresholds = { ...config.thresholds, failOn };

  // Area filter.
  let areas: AreaConfig[] = config.areas;
  if (opts.area) {
    areas = config.areas.filter((a) => a.name === opts.area);
    if (areas.length === 0) {
      throw new RuntimeError(
        `--area "${opts.area}" not found. Configured areas: ${config.areas
          .map((a) => a.name)
          .join(", ")}`,
      );
    }
  }

  const repoPath = resolve(config.repo.path);
  const branch = config.repo.branch ?? (await currentBranch(repoPath));

  // --- Churn ---
  log.info(`Analyzing git history (${windowDays} days) on ${branch}…`);
  const commits = await getCommits({ repoPath, branch: config.repo.branch, windowDays });
  const correlation = correlateChurn(commits, areas, {
    bulkChangeFileThreshold: config.churn.bulkChangeFileThreshold,
    ignore: config.churn.ignore,
    unmappedNoiseFloor: UNMAPPED_NOISE_FLOOR,
    maxSubjects: AI_SUBJECT_LIMIT,
  });

  // --- Testiny ---
  const testiny = makeTestinyClient();
  log.info(`Resolving Testiny project "${config.testiny.project}"…`);
  const project = await resolveProject(testiny, config.testiny.project);
  const folders = await testiny.listFolders(project.id);

  const casesByArea = new Map<string, TestinyCase[]>();
  const folderFoundByArea = new Map<string, boolean>();
  for (const area of areas) {
    const folder = resolveFolder(folders, area.testiny.folder);
    if (!folder) {
      folderFoundByArea.set(area.name, false);
      casesByArea.set(area.name, []);
      log.warn(`Folder "${area.testiny.folder}" not found for area "${area.name}"`);
      continue;
    }
    folderFoundByArea.set(area.name, true);
    const cases = await getCasesForFolder(testiny, project.id, folders, folder);
    casesByArea.set(area.name, cases);
    log.info(`Area "${area.name}": ${cases.length} case(s) in "${folder.name}"`);
  }

  // --- Orphan existence check (fs + tracked files) ---
  const tracked = new Set(await listTrackedFiles(repoPath));
  const referenceExists = makeReferenceExists(repoPath, tracked);

  // --- Findings ---
  const { findings, areaReports } = generateFindings({
    areas: areas.map((area) => {
      const churn = correlation.areaChurn.get(area.name);
      if (!churn) throw new RuntimeError(`Internal: missing churn for area ${area.name}`);
      return {
        area,
        churn,
        folderFound: folderFoundByArea.get(area.name) ?? false,
        cases: casesByArea.get(area.name) ?? [],
      };
    }),
    overlaps: correlation.overlaps,
    unmapped: correlation.unmapped,
    thresholds,
    referenceExists,
  });

  // --- Optional AI coverage judgment ---
  if (opts.ai) {
    await attachAiCoverage(findings, areas, correlation, casesByArea, log);
  }

  const failed = auditFailed(findings, failOn);
  const runInfo: RunInfo = {
    repo: repoPath,
    branch,
    windowDays,
    generatedAt: new Date().toISOString(),
    status: failed ? "FAIL" : "PASS",
    aiEnabled: opts.ai,
  };

  await emitReports(opts, runInfo, areaReports, findings, log);

  return failed ? EXIT_AUDIT_FAILED : EXIT_OK;
}

function makeTestinyClient(): TestinyClient {
  const apiKey = process.env.TESTINY_API_KEY;
  if (!apiKey) {
    throw new CredentialError(
      "TESTINY_API_KEY is not set. Export it before running the audit.",
    );
  }
  return new TestinyClient({
    apiKey,
    baseUrl: process.env.TESTINY_BASE_URL,
  });
}

function makeReferenceExists(repoPath: string, tracked: Set<string>) {
  return (ref: Reference): boolean => {
    if (ref.kind === "path") {
      const rel = ref.token.replace(/^\.?\//, "");
      if (tracked.has(rel)) return true;
      return existsSync(join(repoPath, rel));
    }
    // route: does any tracked file path contain the route (sans leading slash)?
    const needle = ref.token.replace(/^\//, "");
    if (needle.length < 3) return true; // too generic to flag confidently
    for (const f of tracked) {
      if (f.includes(needle)) return true;
    }
    return false;
  };
}

async function attachAiCoverage(
  findings: Finding[],
  areas: AreaConfig[],
  correlation: ReturnType<typeof correlateChurn>,
  casesByArea: Map<string, TestinyCase[]>,
  log: Logger,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CredentialError(
      "ANTHROPIC_API_KEY is not set but --ai was requested.",
    );
  }
  const ai = new AiClient({ apiKey });

  for (const finding of findings) {
    if (finding.type !== "coverage-gap" || !finding.area) continue;
    const churn = correlation.areaChurn.get(finding.area);
    const cases = casesByArea.get(finding.area) ?? [];
    const titles = cases.map((c) => c.title);
    log.info(`AI: judging coverage for "${finding.area}"…`);
    const judgment = await ai.judgeCoverage(
      finding.area,
      churn?.recentSubjects ?? [],
      titles,
    );
    finding.ai = judgment
      ? { rating: judgment.rating, suggestions: judgment.suggestions }
      : { unavailable: true };
  }
}

async function emitReports(
  opts: AuditOptions,
  runInfo: RunInfo,
  areaReports: AreaReport[],
  findings: Finding[],
  log: Logger,
): Promise<void> {
  const wantMd = opts.format === "md" || opts.format === "both";
  const wantJson = opts.format === "json" || opts.format === "both";

  const md = wantMd ? buildMarkdownReport(runInfo, areaReports, findings) : null;
  const json = wantJson
    ? renderJsonReport(buildJsonReport(runInfo, areaReports, findings))
    : null;

  if (opts.out) {
    const outDir = resolve(opts.out);
    await mkdir(outDir, { recursive: true });
    if (md) {
      const p = join(outDir, "audit-report.md");
      await writeFile(p, md, "utf8");
      log.warn(`Wrote ${p}`);
    }
    if (json) {
      const p = join(outDir, "audit-report.json");
      await writeFile(p, json, "utf8");
      log.warn(`Wrote ${p}`);
    }
    return;
  }

  // No --out: print to stdout. Prefer md, unless only json requested.
  if (opts.format === "json" && json) {
    process.stdout.write(json);
  } else if (md) {
    process.stdout.write(md);
    if (json) process.stdout.write(`\n${json}`);
  } else if (json) {
    process.stdout.write(json);
  }
}
