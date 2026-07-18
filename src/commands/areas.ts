import { loadConfig } from "../config/load.js";
import { CredentialError, EXIT_OK } from "../errors.js";
import { TestinyClient } from "../testiny/client.js";
import { resolveAreaCatalogs } from "../testiny/resolve.js";
import { makeLogger } from "../output.js";

/**
 * `catalog-audit areas` — fast sanity check that config + credentials work.
 * Lists configured areas with resolved Testiny projects/folders and case counts.
 */

export interface AreasOptions {
  config: string;
  verbose: boolean;
}

export async function runAreas(opts: AreasOptions): Promise<number> {
  const log = makeLogger(opts.verbose);
  const config = loadConfig(opts.config);

  const apiKey = process.env.TESTINY_API_KEY;
  if (!apiKey) {
    throw new CredentialError("TESTINY_API_KEY is not set.");
  }
  const testiny = new TestinyClient({ apiKey, baseUrl: process.env.TESTINY_BASE_URL });

  log.info("Resolving Testiny catalogs…");
  const catalogs = await resolveAreaCatalogs(
    testiny,
    config.areas.map((a) => ({ name: a.name, project: a.testiny.project, folder: a.testiny.folder })),
    { defaultProject: config.testiny.project, warn: (msg) => log.warn(msg) },
  );

  const rows: Array<{ area: string; team: string; project: string; folder: string; cases: string }> =
    [];
  for (const area of config.areas) {
    const catalog = catalogs.byArea.get(area.name);
    if (!catalog) continue;
    rows.push({
      area: area.name,
      team: area.team,
      project: catalog.project?.name ?? `${catalog.projectRef} (NOT FOUND)`,
      folder: catalog.folderFound
        ? catalog.folderLabel
        : catalog.project
          ? `${catalog.folderLabel} (NOT FOUND)`
          : "-",
      cases: catalog.folderFound ? String(catalog.cases.length) : "-",
    });
  }

  process.stdout.write(renderTable(rows));
  return EXIT_OK;
}

function renderTable(
  rows: Array<{ area: string; team: string; project: string; folder: string; cases: string }>,
): string {
  const headers = {
    area: "AREA",
    team: "TEAM",
    project: "TESTINY PROJECT",
    folder: "FOLDER",
    cases: "CASES",
  };
  const all = [headers, ...rows];
  const w = {
    area: Math.max(...all.map((r) => r.area.length)),
    team: Math.max(...all.map((r) => r.team.length)),
    project: Math.max(...all.map((r) => r.project.length)),
    folder: Math.max(...all.map((r) => r.folder.length)),
    cases: Math.max(...all.map((r) => r.cases.length)),
  };
  const line = (r: typeof headers) =>
    `${r.area.padEnd(w.area)}  ${r.team.padEnd(w.team)}  ${r.project.padEnd(w.project)}  ${r.folder.padEnd(w.folder)}  ${r.cases.padStart(w.cases)}`;
  return `${line(headers)}\n${rows.map(line).join("\n")}\n`;
}
