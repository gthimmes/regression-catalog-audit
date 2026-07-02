import { describe, expect, it } from "vitest";
import { BULK_WEIGHT, commitWeight, computeChurnScore } from "../../src/churn/score.js";

describe("computeChurnScore", () => {
  it("applies the documented composite formula", () => {
    // round(10*3 + 20 + 500/100) = round(30 + 20 + 5) = 55
    expect(computeChurnScore({ commits: 10, filesChanged: 20, linesDelta: 500 })).toBe(55);
  });

  it("rounds fractional (bulk-weighted) inputs", () => {
    // round(0.25*3 + 15 + 150/100) = round(0.75 + 15 + 1.5) = 17
    expect(computeChurnScore({ commits: 0.25, filesChanged: 15, linesDelta: 150 })).toBe(17);
  });

  it("is zero for no activity", () => {
    expect(computeChurnScore({ commits: 0, filesChanged: 0, linesDelta: 0 })).toBe(0);
  });
});

describe("commitWeight", () => {
  it("weights commits over the bulk threshold at BULK_WEIGHT", () => {
    expect(commitWeight(60, 50)).toBe(BULK_WEIGHT);
  });

  it("weights normal commits at 1", () => {
    expect(commitWeight(50, 50)).toBe(1);
    expect(commitWeight(3, 50)).toBe(1);
  });
});
