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
    expect(issues.join("\n")).toMatch(/areas/);
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(() => validateConfig({ ...minimal, bogus: true })).toThrow(ConfigError);
  });

  it("accepts per-area testiny.project with no top-level default", () => {
    const cfg = validateConfig({
      version: 1,
      areas: [
        {
          name: "billing",
          team: "Ledger",
          paths: ["apps/billing/**"],
          testiny: { project: "Billing & AR" },
        },
      ],
    });
    expect(cfg.testiny.project).toBeUndefined();
    expect(cfg.areas[0]?.testiny.project).toBe("Billing & AR");
    expect(cfg.areas[0]?.testiny.folder).toBeUndefined();
  });

  it("rejects an area with no project anywhere (own or default)", () => {
    let err: unknown;
    try {
      validateConfig({
        version: 1,
        areas: [
          {
            name: "billing",
            team: "Ledger",
            paths: ["apps/billing/**"],
            testiny: { folder: "Billing" },
          },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const issues = (err as ConfigError).issues.join("\n");
    expect(issues).toMatch(/areas\.0\.testiny\.project/);
    expect(issues).toMatch(/no Testiny project/);
  });

  it("area folder is optional when a project is set (whole-project catalog)", () => {
    const cfg = validateConfig({
      ...minimal,
      areas: [
        {
          name: "payments",
          team: "Valkyrie",
          paths: ["apps/payments/**"],
          testiny: {},
        },
      ],
    });
    expect(cfg.areas[0]?.testiny.folder).toBeUndefined();
  });
});
