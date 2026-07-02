import { describe, expect, it } from "vitest";
import {
  coverageJudgmentPrompt,
  mappingSuggestionPrompt,
} from "../../src/ai/prompts.js";

describe("mappingSuggestionPrompt", () => {
  it("interpolates unmapped paths and folder names", () => {
    const prompt = mappingSuggestionPrompt({
      unmappedPaths: ["apps/billing/index.ts"],
      folders: ["Payments", "Billing"],
    });
    expect(prompt).toContain("apps/billing/index.ts");
    expect(prompt).toContain("Payments");
    expect(prompt).toContain("Billing");
    expect(prompt).toContain("```yaml");
  });

  it("handles empty inputs without throwing", () => {
    const prompt = mappingSuggestionPrompt({ unmappedPaths: [], folders: [] });
    expect(prompt).toContain("(none)");
  });
});

describe("coverageJudgmentPrompt", () => {
  it("interpolates area name, commit subjects, and case titles", () => {
    const prompt = coverageJudgmentPrompt({
      areaName: "payments",
      commitSubjects: ["Fix refund rounding"],
      caseTitles: ["Refund happy path"],
    });
    expect(prompt).toContain("payments");
    expect(prompt).toContain("Fix refund rounding");
    expect(prompt).toContain("Refund happy path");
    expect(prompt).toContain("rating");
    expect(prompt).toContain("```json");
  });
});
