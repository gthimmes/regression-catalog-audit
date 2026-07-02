import { describe, expect, it } from "vitest";
import { validateConfig } from "../../src/config/load.js";
import { ConfigError } from "../../src/errors.js";

const minimal = {
  version: 1,
  testiny: { project: "Regression Catalogs" },
  areas: [
    {
      name: "payments",
      team: "Valkyrie",
      paths: ["apps/payments/**"],
      testiny: { folder: "Payments" },
    },
  ],
};

describe("validateConfig", () => {
  it("applies defaults for optional sections", () => {
    const cfg = validateConfig(minimal);
    expect(cfg.repo.path).toBe(".");
    expect(cfg.churn.windowDays).toBe(90);
    expect(cfg.churn.bulkChangeFileThreshold).toBe(50);
    expect(cfg.thresholds.gapChurnScore).toBe(50);
    expect(cfg.thresholds.failOn).toBe("high");
    expect(cfg.areas[0]?.minCases).toBe(1);
  });

  it("collects every violation with its YAML path", () => {
    let err: unknown;
    try {
      validateConfig({ version: 2, areas: [] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const issues = (err as ConfigError).issues;
    expect(issues.join("\n")).toMatch(/version/);
    expect(issues.join("\n")).toMatch(/testiny/);
    expect(issues.join("\n")).toMatch(/areas/);
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(() => validateConfig({ ...minimal, bogus: true })).toThrow(ConfigError);
  });
});
