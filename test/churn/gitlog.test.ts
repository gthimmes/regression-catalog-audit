import { describe, expect, it } from "vitest";
import { parseGitLog } from "../../src/churn/gitlog.js";

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

function header(hash: string, iso: string, subject: string): string {
  return `${RS}${hash}${US}${iso}${US}${subject}`;
}

describe("parseGitLog", () => {
  it("parses commits, numstat, binary files, and rename paths", () => {
    const raw = [
      header("abc123", "2026-06-01T10:00:00+00:00", "Fix payments bug"),
      "10\t2\tapps/payments/checkout.ts",
      "-\t-\tassets/logo.png",
      "",
      header("def456", "2026-05-20T09:00:00+00:00", "Move portal home"),
      "3\t1\tapps/portal/{old => home}.tsx",
    ].join("\n");

    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);

    const [first, second] = commits;
    expect(first?.hash).toBe("abc123");
    expect(first?.subject).toBe("Fix payments bug");
    expect(first?.date.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(first?.files).toHaveLength(2);
    expect(first?.files[0]).toMatchObject({
      path: "apps/payments/checkout.ts",
      added: 10,
      deleted: 2,
      binary: false,
    });
    expect(first?.files[1]).toMatchObject({ path: "assets/logo.png", binary: true, added: 0, deleted: 0 });

    expect(second?.files[0]?.path).toBe("apps/portal/home.tsx");
  });

  it("returns an empty array for empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});
