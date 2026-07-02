import { describe, expect, it } from "vitest";
import { detectOrphans, extractReferences } from "../../src/audit/orphans.js";
import type { TestinyCase } from "../../src/testiny/client.js";

function makeCase(id: number, title: string, description: string | null): TestinyCase {
  return {
    id,
    title,
    description,
    folderId: 1,
    createdAt: null,
    modifiedAt: null,
    tags: [],
  };
}

describe("extractReferences", () => {
  it("extracts file-path-like tokens", () => {
    const refs = extractReferences("Verify apps/payments/checkout.ts renders");
    expect(refs).toContainEqual({ token: "apps/payments/checkout.ts", kind: "path" });
  });

  it("extracts route-like tokens", () => {
    const refs = extractReferences("Navigate to /api/payments/refund and submit");
    expect(refs.some((r) => r.kind === "route" && r.token === "/api/payments/refund")).toBe(true);
  });

  it("does not treat a bare sentence word as a reference", () => {
    const refs = extractReferences("This checks the refund flow works.");
    expect(refs).toHaveLength(0);
  });
});

describe("detectOrphans", () => {
  it("flags a case that references a path no longer present", () => {
    const cases = [makeCase(1, "Checkout", "Covers apps/payments/legacy-checkout.ts")];
    const findings = detectOrphans(cases, () => false);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe("orphaned-case");
    expect(findings[0]?.severity).toBe("medium");
  });

  it("does NOT flag a case whose references all exist", () => {
    const cases = [makeCase(1, "Checkout", "Covers apps/payments/checkout.ts")];
    const findings = detectOrphans(cases, () => true);
    expect(findings).toHaveLength(0);
  });

  it("does NOT flag a case with no extractable references", () => {
    const cases = [makeCase(1, "Refund flow works", "The refund succeeds")];
    const findings = detectOrphans(cases, () => false);
    expect(findings).toHaveLength(0);
  });
});
