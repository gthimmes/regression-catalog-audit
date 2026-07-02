import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_VERSION } from "../../src/report/json.js";
import { buildFixture } from "../fixtures/pipeline.js";

describe("end-to-end fixture audit", () => {
  it("is deterministic across runs", () => {
    const a = buildFixture();
    const b = buildFixture();
    expect(a.markdown).toEqual(b.markdown);
    expect(a.jsonText).toEqual(b.jsonText);
  });

  it("produces every expected finding type", () => {
    const { json } = buildFixture();
    const types = new Set(json.findings.map((f) => f.type));
    expect(types).toContain("missing-catalog"); // shared folder missing
    expect(types).toContain("coverage-gap"); // payments: high churn, healthy < minCases
    expect(types).toContain("stale-catalog"); // payments: >=50% stale
    expect(types).toContain("stale-case"); // payments cases 1 & 2
    expect(types).toContain("orphaned-case"); // payments case 3 -> legacy.ts
    expect(types).toContain("unmapped-churn"); // scripts/deploy.sh
    expect(types).toContain("overlapping-areas"); // apps/** shared overlap
  });

  it("marks the run FAILED under failOn=high", () => {
    const { json, failed } = buildFixture();
    expect(failed).toBe(true);
    expect(json.runInfo.status).toBe("FAIL");
  });

  it("emits a versioned JSON contract with per-area stats", () => {
    const { json } = buildFixture();
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.areas).toHaveLength(3);
    const payments = json.areas.find((a) => a.name === "payments");
    expect(payments?.churnScore).toBeGreaterThanOrEqual(50);
    expect(payments?.staleCases).toBe(2);
    expect(payments?.healthyCases).toBe(1);
    const shared = json.areas.find((a) => a.name === "shared");
    expect(shared?.folderFound).toBe(false);
  });

  it("renders Markdown with a summary, table, and no HTML", () => {
    const { markdown } = buildFixture();
    expect(markdown).toContain("# Regression Catalog Audit");
    expect(markdown).toContain("## Areas");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("❌ FAIL");
    expect(markdown).not.toMatch(/<[a-z]+>/i);
  });
});
