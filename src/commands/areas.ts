import { loadConfig } from "../config/load.js";
import { CredentialError, EXIT_OK } from "../errors.js";
import { TestinyClient } from "../testiny/client.js";
import { getCasesForFolder, resolveFolder, resolveProject } from "../testiny/resolve.js";
import { makeLogger } from "../output.js";

/**
 * `catalog-audit areas` — fast sanity check that config + credentials work.
 * Lists configured areas with resolved Testiny folders and case counts.
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

  log.info(`Resolving project "${config.testiny.project}"…`);
  const project = await resolveProject(testiny, config.testiny.project);
  const folders = await testiny.listFolders(project.id);

  const rows: Array<{ area: string; team: string; folder: string; cases: string }> = [];
  for (const area of config.areas) {
    const folder = resolveFolder(folders, area.testiny.folder);
    if (!folder) {
      rows.push({
        area: area.name,
        team: area.team,
        folder: `${area.testiny.folder} (NOT FOUND)`,
        cases: "-",
      });
      continue;
    }
    const cases = await getCasesForFolder(testiny, project.id, folders, folder);
    rows.push({
      area: area.name,
      team: area.team,
      folder: folder.name,
      cases: String(cases.length),
    });
  }

  process.stdout.write(`Project: ${project.name} (id ${project.id})\n\n`);
  process.stdout.write(renderTable(rows));
  return EXIT_OK;
}

function renderTable(
  rows: Array<{ area: string; team: string; folder: string; cases: string }>,
): string {
  const headers = { area: "AREA", team: "TEAM", folder: "TESTINY FOLDER", cases: "CASES" };
  const all = [headers, ...rows];
  const w = {
    area: Math.max(...all.map((r) => r.area.length)),
    team: Math.max(...all.map((r) => r.team.length)),
    folder: Math.max(...all.map((r) => r.folder.length)),
    cases: Math.max(...all.map((r) => r.cases.length)),
  };
  const line = (r: typeof headers) =>
    `${r.area.padEnd(w.area)}  ${r.team.padEnd(w.team)}  ${r.folder.padEnd(w.folder)}  ${r.cases.padStart(w.cases)}`;
  return `${line(headers)}\n${rows.map(line).join("\n")}\n`;
}
