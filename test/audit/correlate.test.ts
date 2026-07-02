import { describe, expect, it } from "vitest";
import type { Commit, CommitFileChange } from "../../src/churn/gitlog.js";
import { correlateChurn } from "../../src/audit/correlate.js";
import type { AreaConfig } from "../../src/config/schema.js";

function file(path: string, added = 5, deleted = 5): CommitFileChange {
  return { path, added, deleted, binary: false };
}

function commit(hash: string, date: string, files: CommitFileChange[], subject = "x"): Commit {
  return { hash, date: new Date(date), subject, files };
}

const payments: AreaConfig = {
  name: "payments",
  team: "Valkyrie",
  paths: ["apps/payments/**"],
  testiny: { folder: "Payments" },
  minCases: 1,
};

const opts = {
  bulkChangeFileThreshold: 50,
  ignore: ["**/*.md"],
  unmappedNoiseFloor: 3,
};

describe("correlateChurn — bulk weighting", () => {
  it("barely moves churnScore for a large codemod commit vs. unweighted", () => {
    const bulkFiles = Array.from({ length: 60 }, (_, i) =>
      file(`apps/payments/f${i}.ts`, 5, 5),
    );
    const bulkCommit = commit("bulk", "2026-06-01T00:00:00Z", bulkFiles);

    const weighted = correlateChurn([bulkCommit], [payments], opts)
      .areaChurn.get("payments")!.churnScore;

    // Same commit, but the threshold is high enough that it is NOT bulk.
    const unweighted = correlateChurn([bulkCommit], [payments], {
      ...opts,
      bulkChangeFileThreshold: 1000,
    }).areaChurn.get("payments")!.churnScore;

    expect(weighted).toBeLessThan(unweighted);
    expect(weighted).toBeLessThan(unweighted / 3); // ~0.25x contribution
  });
});

describe("correlateChurn — mapping", () => {
  it("ignores paths matching the ignore globs", () => {
    const c = commit("c1", "2026-06-01T00:00:00Z", [
      file("apps/payments/checkout.ts"),
      file("apps/payments/README.md"),
    ]);
    const churn = correlateChurn([c], [payments], opts).areaChurn.get("payments")!;
    expect(churn.filesChanged).toBe(1);
  });

  it("detects overlapping ownership", () => {
    const shared: AreaConfig = { ...payments, name: "shared", paths: ["apps/**"] };
    const c = commit("c1", "2026-06-01T00:00:00Z", [file("apps/payments/checkout.ts")]);
    const result = correlateChurn([c], [payments, shared], opts);
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0]?.areas).toEqual(["payments", "shared"]);
  });

  it("reports unmapped churn only above the noise floor", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 4; i++) {
      commits.push(commit(`u${i}`, "2026-06-01T00:00:00Z", [file("misc/thing.ts")]));
    }
    // A path with exactly the floor count is NOT reported.
    for (let i = 0; i < 3; i++) {
      commits.push(commit(`v${i}`, "2026-06-01T00:00:00Z", [file("other/quiet.ts")]));
    }
    const result = correlateChurn(commits, [payments], opts);
    const paths = result.unmapped.map((u) => u.path);
    expect(paths).toContain("misc/thing.ts");
    expect(paths).not.toContain("other/quiet.ts");
  });
});
