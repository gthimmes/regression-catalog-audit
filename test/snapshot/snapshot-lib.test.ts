import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS module without type declarations
import {
  computeDeltas,
  computeTotals,
  fmtDelta,
  makeHistoryEntry,
  makeLegacyMatcher,
  previousEntry,
  summarizeProject,
  topFolder,
  upsertHistory,
} from "../../scripts/snapshot-lib.mjs";

const isLegacy = makeLegacyMatcher(["historical", "deprecated", "zzz", "_old", "\\bold\\b"]);

function testCase(folder: string, extras: Record<string, unknown> = {}) {
  return { id: 1, title: "t", folder, testcase_type: null, automationstatus: null, ...extras };
}

describe("topFolder / makeLegacyMatcher", () => {
  it("takes the top segment of a nested folder path", () => {
    expect(topFolder("Payments > Checkout > Edge")).toBe("Payments");
    expect(topFolder(null)).toBe("(none)");
  });

  it("matches legacy folder names case-insensitively", () => {
    expect(isLegacy("0. Historical Test Cases")).toBe(true);
    expect(isLegacy("ZZZ_OLD_CXP")).toBe(true);
    expect(isLegacy("Deprecated")).toBe(true);
    expect(isLegacy("Old")).toBe(true);
    expect(isLegacy("Golden Path")).toBe(false); // "old" inside a word must not match
    expect(isLegacy("Payments")).toBe(false);
  });
});

describe("summarizeProject", () => {
  it("counts totals, legacy, automation, and type gaps", () => {
    const cases = [
      testCase("Regression", { automationstatus: "Automated", testcase_type: "REGRESSION" }),
      testCase("Regression", { testcase_type: "OTHER" }),
      testCase("Historical Test Cases > 2021"),
      testCase("Historical Test Cases"),
    ];
    const s = summarizeProject(cases, isLegacy);
    expect(s.total).toBe(4);
    expect(s.legacy).toBe(2);
    expect(s.automated).toBe(1);
    expect(s.untyped).toBe(2);
    expect(s.other).toBe(1);
    expect(s.notable[0]).toEqual(["Regression", 2]);
  });
});

describe("history", () => {
  const projA = { id: "7", name: "Billing", total: 100, automated: 10, legacy: 50, untyped: 0, other: 0 };
  const projB = { id: "14", name: "PayNow", total: 200, automated: 190, legacy: 0, untyped: 0, other: 0 };

  it("computeTotals sums across projects", () => {
    expect(computeTotals([projA, projB])).toEqual({ total: 300, automated: 200, legacy: 50 });
  });

  it("upsertHistory replaces same-date entries and stays date-sorted", () => {
    const e1 = makeHistoryEntry("2026-07-15", [projA]);
    const e2 = makeHistoryEntry("2026-07-18", [projA, projB]);
    const e2b = makeHistoryEntry("2026-07-18", [projB]);
    let h = upsertHistory([], e2);
    h = upsertHistory(h, e1);
    expect(h.map((x: { date: string }) => x.date)).toEqual(["2026-07-15", "2026-07-18"]);
    h = upsertHistory(h, e2b);
    expect(h).toHaveLength(2);
    expect(h[1].totals.total).toBe(200); // replaced, not appended
  });

  it("previousEntry returns the latest entry strictly before the date", () => {
    const h = [
      makeHistoryEntry("2026-07-10", [projA]),
      makeHistoryEntry("2026-07-15", [projA]),
    ];
    expect(previousEntry(h, "2026-07-18")?.date).toBe("2026-07-15");
    expect(previousEntry(h, "2026-07-15")?.date).toBe("2026-07-10");
    expect(previousEntry(h, "2026-07-01")).toBeNull();
  });

  it("computeDeltas diffs vs the previous entry and flags new projects", () => {
    const prev = makeHistoryEntry("2026-07-15", [projA]);
    const current = [{ ...projA, total: 112, automated: 15 }, projB];
    const d = computeDeltas(current, prev);
    expect(d?.since).toBe("2026-07-15");
    expect(d?.totals.total).toBe(312 - 100);
    expect(d?.perProject["7"]).toEqual({ total: 12, automated: 5, legacy: 0, isNew: false });
    expect(d?.perProject["14"]?.isNew).toBe(true);
  });

  it("computeDeltas returns null on the first run", () => {
    expect(computeDeltas([projA], null)).toBeNull();
  });
});

describe("fmtDelta", () => {
  it("formats signed deltas", () => {
    expect(fmtDelta(0)).toBe("±0");
    expect(fmtDelta(12)).toBe("+12");
    expect(fmtDelta(-3)).toBe("−3");
    expect(fmtDelta(1200)).toBe("+1,200");
  });
});
