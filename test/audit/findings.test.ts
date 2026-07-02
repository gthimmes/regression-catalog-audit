import { describe, expect, it } from "vitest";
import type { AreaChurn } from "../../src/audit/correlate.js";
import { auditFailed, generateFindings } from "../../src/audit/findings.js";
import type { AreaConfig } from "../../src/config/schema.js";
import type { TestinyCase } from "../../src/testiny/client.js";
import type { Finding } from "../../src/types.js";

function area(name: string, minCases = 1): AreaConfig {
  return {
    name,
    team: "Team",
    paths: [`apps/${name}/**`],
    testiny: { folder: name },
    minCases,
  };
}

function churn(a: AreaConfig, over: Partial<AreaChurn> = {}): AreaChurn {
  return {
    area: a,
    commits: 0,
    filesChanged: 0,
    linesDelta: 0,
    lastChangedAt: null,
    churnScore: 0,
    recentSubjects: [],
    matchingCommits: [],
    ...over,
  };
}

/** A commit that lands a lot of churn on a given date (drives staleness). */
function bigCommit(date: string) {
  return { date: new Date(date), weight: 1, files: 10, lines: 20000 };
}

function testCase(id: number, modifiedAt: string | null): TestinyCase {
  return {
    id,
    title: `Case ${id}`,
    description: null,
    folderId: 1,
    createdAt: null,
    modifiedAt,
    tags: [],
  };
}

const thresholds = { gapChurnScore: 50, staleChurnScore: 100, failOn: "high" as const };
const noOrphans = () => true;

describe("generateFindings — finding types", () => {
  it("missing-catalog when the folder is not found", () => {
    const a = area("payments");
    const { findings } = generateFindings({
      areas: [{ area: a, churn: churn(a), folderFound: false, cases: [] }],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.map((f) => f.type)).toContain("missing-catalog");
    expect(findings[0]?.severity).toBe("high");
  });

  it("missing-catalog when the folder is empty", () => {
    const a = area("payments");
    const { findings } = generateFindings({
      areas: [{ area: a, churn: churn(a), folderFound: true, cases: [] }],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.some((f) => f.type === "missing-catalog")).toBe(true);
  });

  it("coverage-gap when churn is high and healthy cases < minCases", () => {
    const a = area("payments", 2);
    // One healthy case (updated after the churn), so healthyCases = 1 < 2.
    const cases = [testCase(1, "2027-01-01T00:00:00Z")];
    const { findings } = generateFindings({
      areas: [
        {
          area: a,
          churn: churn(a, { churnScore: 60, matchingCommits: [bigCommit("2026-06-01T00:00:00Z")] }),
          folderFound: true,
          cases,
        },
      ],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.some((f) => f.type === "coverage-gap" && f.severity === "high")).toBe(true);
  });

  it("does NOT produce coverage-gap just below the churn threshold", () => {
    const a = area("payments", 2);
    const cases = [testCase(1, "2027-01-01T00:00:00Z")];
    const { findings } = generateFindings({
      areas: [
        { area: a, churn: churn(a, { churnScore: 49 }), folderFound: true, cases },
      ],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.some((f) => f.type === "coverage-gap")).toBe(false);
  });

  it("stale-case + stale-catalog(high) when all cases are stale", () => {
    const a = area("payments");
    const cases = [testCase(1, "2020-01-01T00:00:00Z"), testCase(2, "2020-01-01T00:00:00Z")];
    const { findings } = generateFindings({
      areas: [
        {
          area: a,
          churn: churn(a, { matchingCommits: [bigCommit("2026-06-01T00:00:00Z")] }),
          folderFound: true,
          cases,
        },
      ],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.filter((f) => f.type === "stale-case")).toHaveLength(2);
    const catalog = findings.find((f) => f.type === "stale-catalog");
    expect(catalog?.severity).toBe("high"); // 100% stale
  });

  it("stale-catalog is medium at exactly 50% stale", () => {
    const a = area("payments");
    const cases = [testCase(1, "2020-01-01T00:00:00Z"), testCase(2, "2027-01-01T00:00:00Z")];
    const { findings } = generateFindings({
      areas: [
        {
          area: a,
          churn: churn(a, { matchingCommits: [bigCommit("2026-06-01T00:00:00Z")] }),
          folderFound: true,
          cases,
        },
      ],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.find((f) => f.type === "stale-catalog")?.severity).toBe("medium");
  });

  it("does NOT produce stale-catalog below 50% stale", () => {
    const a = area("payments");
    const cases = [
      testCase(1, "2020-01-01T00:00:00Z"),
      testCase(2, "2027-01-01T00:00:00Z"),
      testCase(3, "2027-01-01T00:00:00Z"),
    ];
    const { findings } = generateFindings({
      areas: [
        {
          area: a,
          churn: churn(a, { matchingCommits: [bigCommit("2026-06-01T00:00:00Z")] }),
          folderFound: true,
          cases,
        },
      ],
      overlaps: [],
      unmapped: [],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.some((f) => f.type === "stale-catalog")).toBe(false);
  });

  it("overlapping-areas (warning) and unmapped-churn (medium)", () => {
    const a = area("payments");
    const { findings } = generateFindings({
      areas: [{ area: a, churn: churn(a), folderFound: true, cases: [testCase(1, "2027-01-01T00:00:00Z")] }],
      overlaps: [{ path: "apps/x.ts", areas: ["payments", "shared"] }],
      unmapped: [{ path: "misc/thing.ts", commits: 5 }],
      thresholds,
      referenceExists: noOrphans,
    });
    expect(findings.find((f) => f.type === "overlapping-areas")?.severity).toBe("warning");
    expect(findings.find((f) => f.type === "unmapped-churn")?.severity).toBe("medium");
  });
});

describe("auditFailed — exit-code gating", () => {
  const high: Finding = { type: "coverage-gap", severity: "high", message: "" };
  const medium: Finding = { type: "unmapped-churn", severity: "medium", message: "" };
  const low: Finding = { type: "stale-case", severity: "low", message: "" };
  const warning: Finding = { type: "overlapping-areas", severity: "warning", message: "" };

  it("fails on high with a high finding", () => {
    expect(auditFailed([high, low], "high")).toBe(true);
  });

  it("does not fail on high with only medium/low findings", () => {
    expect(auditFailed([medium, low], "high")).toBe(false);
  });

  it("fails on medium with a medium finding", () => {
    expect(auditFailed([medium], "medium")).toBe(true);
  });

  it("fails on low with a low finding", () => {
    expect(auditFailed([low], "low")).toBe(true);
  });

  it("never fails when failOn is never, even with high findings", () => {
    expect(auditFailed([high], "never")).toBe(false);
  });

  it("warnings never fail the audit", () => {
    expect(auditFailed([warning], "low")).toBe(false);
  });
});
