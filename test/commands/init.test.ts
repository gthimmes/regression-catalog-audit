import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { starterYaml } from "../../src/commands/init.js";
import { validateConfig } from "../../src/config/load.js";

describe("init starter template", () => {
  it("produces YAML that passes config validation", () => {
    const cfg = validateConfig(parseYaml(starterYaml("Regression Catalogs")));
    expect(cfg.testiny.project).toBe("Regression Catalogs");
    expect(cfg.areas).toHaveLength(1);
    expect(cfg.areas[0]?.testiny.folder).toBe("Example");
  });

  it("quotes project names safely", () => {
    const cfg = validateConfig(parseYaml(starterYaml('Team "Q&A": special')));
    expect(cfg.testiny.project).toBe('Team "Q&A": special');
  });
});
