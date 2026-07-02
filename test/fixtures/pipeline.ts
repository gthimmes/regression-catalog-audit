import { correlateChurn } from "../../src/audit/correlate.js";
import { auditFailed, generateFindings } from "../../src/audit/findings.js";
import type { Reference } from "../../src/audit/orphans.js";
import { parseGitLog } from "../../src/churn/gitlog.js";
import type { AreaConfig } from "../../src/config/schema.js";
import { buildJsonReport, type JsonReport, renderJsonReport } from "../../src/report/json.js";
import { buildMarkdownReport } from "../../src/report/markdown.js";
import type { TestinyCase } from "../../src/testiny/client.js";
import type { RunInfo } from "../../src/types.js";

/**
 * A fully offline end-to-end audit over frozen fixtures (no git, no network).
 * Used by the report snapshot test and by `npm run audit:fixture`, so both
 * exercise the real correlate → findings → report pipeline deterministically.
 */

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

interface FixtureFile {
  path: string;
  added: number;
  deleted: number;
}
interface FixtureCommit {
  hash: string;
  date: string;
  subject: string;
  files: FixtureFile[];
}

function toRawLog(commits: FixtureCommit[]): string {
  const blocks = commits.map((c) => {
    const lines = [`${RS}${c.hash}${US}${c.date}${US}${c.subject}`];
    for (const f of c.files) lines.push(`${f.added}\t${f.deleted}\t${f.path}`);
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

const FIXTURE_COMMITS: FixtureCommit[] = [
  {
    hash: "c1",
    date: "2026-06-01T00:00:00Z",
    subject: "Rework checkout",
    files: [{ path: "apps/payments/checkout.ts", added: 100, deleted: 50 }],
  },
  {
    hash: "c2",
    date: "2026-06-02T00:00:00Z",
    subject: "Refund fixes",
    files: [{ path: "apps/payments/refund.ts", added: 100, deleted: 50 }],
  },
  {
    hash: "c3",
    date: "2026-06-03T00:00:00Z",
    subject: "Payments API overhaul",
    files: [
      { path: "apps/payments/api.ts", added: 900, deleted: 100 },
      { path: "apps/payments/checkout.ts", added: 50, deleted: 50 },
    ],
  },
  {
    hash: "c4",
    date: "2026-06-04T00:00:00Z",
    subject: "More refund work",
    files: [{ path: "apps/payments/refund.ts", added: 900, deleted: 100 }],
  },
  {
    hash: "c5",
    date: "2026-06-05T00:00:00Z",
    subject: "Checkout polish",
    files: [{ path: "apps/payments/checkout.ts", added: 400, deleted: 400 }],
  },
  {
    hash: "p1",
    date: "2026-06-01T00:00:00Z",
    subject: "Portal copy tweak",
    files: [{ path: "apps/portal/home.tsx", added: 10, deleted: 5 }],
  },
  // Unmapped path changed in 4 commits (> noise floor of 3).
  ...["d1", "d2", "d3", "d4"].map((hash, i) => ({
    hash,
    date: `2026-06-0${i + 1}T12:00:00Z`,
    subject: "Tweak deploy script",
    files: [{ path: "scripts/deploy.sh", added: 5, deleted: 5 }],
  })),
];

export const FIXTURE_AREAS: AreaConfig[] = [
  {
    name: "payments",
    team: "Valkyrie",
    paths: ["apps/payments/**"],
    testiny: { folder: "Payments" },
    minCases: 3,
  },
  {
    name: "client-portal",
    team: "Rosetta",
    paths: ["apps/portal/**"],
    testiny: { folder: "Client Portal" },
    minCases: 1,
  },
  {
    // Overlaps with the two above (apps/**) and its folder is missing.
    name: "shared",
    team: "Platform",
    paths: ["apps/**"],
    testiny: { folder: "Shared" },
    minCases: 1,
  },
];

const CASES: Record<string, TestinyCase[]> = {
  payments: [
    {
      id: 1,
      title: "Checkout happy path",
      description: "Covers apps/payments/checkout.ts",
      folderId: 10,
      createdAt: "2020-01-01T00:00:00Z",
      modifiedAt: "2020-01-01T00:00:00Z",
      tags: [],
    },
    {
      id: 2,
      title: "Refund flow",
      description: "Refund succeeds and reverses",
      folderId: 10,
      createdAt: "2020-01-01T00:00:00Z",
      modifiedAt: "2020-01-01T00:00:00Z",
      tags: [],
    },
    {
      id: 3,
      title: "Legacy import",
      description: "Verify apps/payments/legacy.ts still imports",
      folderId: 10,
      createdAt: "2027-01-01T00:00:00Z",
      modifiedAt: "2027-01-01T00:00:00Z",
      tags: [],
    },
  ],
  "client-portal": [
    {
      id: 4,
      title: "Portal loads",
      description: "Home page renders",
      folderId: 20,
      createdAt: "2027-01-01T00:00:00Z",
      modifiedAt: "2027-01-01T00:00:00Z",
      tags: [],
    },
  ],
  shared: [],
};

const FOLDER_FOUND: Record<string, boolean> = {
  payments: true,
  "client-portal": true,
  shared: false, // "Shared" folder does not exist -> missing-catalog
};

// Files that still exist in the (fixture) repo.
const EXISTING_PATHS = new Set(["apps/payments/checkout.ts", "apps/portal/home.tsx"]);

function referenceExists(ref: Reference): boolean {
  if (ref.kind === "path") return EXISTING_PATHS.has(ref.token.replace(/^\.?\//, ""));
  return true; // routes not exercised in this fixture
}

export interface FixtureResult {
  markdown: string;
  jsonText: string;
  json: JsonReport;
  failed: boolean;
}

/** Run the full offline pipeline with a frozen run timestamp. */
export function buildFixture(generatedAt = "2026-07-01T00:00:00.000Z"): FixtureResult {
  const commits = parseGitLog(toRawLog(FIXTURE_COMMITS));
  const correlation = correlateChurn(commits, FIXTURE_AREAS, {
    bulkChangeFileThreshold: 50,
    ignore: ["**/*.md"],
    unmappedNoiseFloor: 3,
  });

  const thresholds = { gapChurnScore: 50, staleChurnScore: 40, failOn: "high" as const };

  const { findings, areaReports } = generateFindings({
    areas: FIXTURE_AREAS.map((area) => ({
      area,
      churn: correlation.areaChurn.get(area.name)!,
      folderFound: FOLDER_FOUND[area.name] ?? false,
      cases: CASES[area.name] ?? [],
    })),
    overlaps: correlation.overlaps,
    unmapped: correlation.unmapped,
    thresholds,
    referenceExists,
  });

  const failed = auditFailed(findings, thresholds.failOn);
  const runInfo: RunInfo = {
    repo: "/fixture/repo",
    branch: "main",
    windowDays: 90,
    generatedAt,
    status: failed ? "FAIL" : "PASS",
    aiEnabled: false,
  };

  const json = buildJsonReport(runInfo, areaReports, findings);
  return {
    markdown: buildMarkdownReport(runInfo, areaReports, findings),
    jsonText: renderJsonReport(json),
    json,
    failed,
  };
}
