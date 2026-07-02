import { AiClient } from "../ai/client.js";
import { correlateChurn } from "../audit/correlate.js";
import { currentBranch, getCommits } from "../churn/gitlog.js";
import { loadConfig } from "../config/load.js";
import { CredentialError, EXIT_OK } from "../errors.js";
import { TestinyClient } from "../testiny/client.js";
import { getCasesForFolder, resolveFolder, resolveProject } from "../testiny/resolve.js";
import { makeLogger } from "../output.js";

/**
 * `catalog-audit map` — reports path→catalog mapping health: unmapped high-churn
 * paths, empty areas, and overlaps. With --ai, proposes `areas` YAML entries for
 * unmapped paths (printed as a suggestion, never auto-applied).
 */

const UNMAPPED_NOISE_FLOOR = 3;

export interface MapOptions {
  config: string;
  ai: boolean;
  out?: string;
  verbose: boolean;
}

export async function runMap(opts: MapOptions): Promise<number> {
  const log = makeLogger(opts.verbose);
  const config = loadConfig(opts.config);
  const { resolve } = await import("node:path");
  const repoPath = resolve(config.repo.path);
  const branch = config.repo.branch ?? (await currentBranch(repoPath));

  log.info(`Analyzing churn (${config.churn.windowDays} days) on ${branch}…`);
  const commits = await getCommits({
    repoPath,
    branch: config.repo.branch,
    windowDays: config.churn.windowDays,
  });
  const correlation = correlateChurn(commits, config.areas, {
    bulkChangeFileThreshold: config.churn.bulkChangeFileThreshold,
    ignore: config.churn.ignore,
    unmappedNoiseFloor: UNMAPPED_NOISE_FLOOR,
  });

  // Testiny: resolve folders and case counts for empty-area detection.
  const apiKey = process.env.TESTINY_API_KEY;
  if (!apiKey) throw new CredentialError("TESTINY_API_KEY is not set.");
  const testiny = new TestinyClient({ apiKey, baseUrl: process.env.TESTINY_BASE_URL });
  const project = await resolveProject(testiny, config.testiny.project);
  const folders = await testiny.listFolders(project.id);

  const emptyAreas: string[] = [];
  for (const area of config.areas) {
    const folder = resolveFolder(folders, area.testiny.folder);
    if (!folder) {
      emptyAreas.push(`${area.name} (folder "${area.testiny.folder}" not found)`);
      continue;
    }
    const cases = await getCasesForFolder(testiny, project.id, folders, folder);
    if (cases.length === 0) emptyAreas.push(`${area.name} (folder "${folder.name}" empty)`);
  }

  const out: string[] = [];
  out.push("# Mapping health\n");

  out.push(`## Unmapped high-churn paths (> ${UNMAPPED_NOISE_FLOOR} commits)`);
  if (correlation.unmapped.length === 0) {
    out.push("_None._");
  } else {
    for (const u of correlation.unmapped) out.push(`- ${u.path} (${u.commits} commits)`);
  }
  out.push("");

  out.push("## Empty / missing areas");
  out.push(emptyAreas.length === 0 ? "_None._" : emptyAreas.map((a) => `- ${a}`).join("\n"));
  out.push("");

  out.push("## Overlapping ownership");
  if (correlation.overlaps.length === 0) {
    out.push("_None._");
  } else {
    for (const o of correlation.overlaps) out.push(`- ${o.path}: ${o.areas.join(", ")}`);
  }
  out.push("");

  if (opts.ai) {
    const aiKey = process.env.ANTHROPIC_API_KEY;
    if (!aiKey) throw new CredentialError("ANTHROPIC_API_KEY is not set but --ai was requested.");
    out.push("## AI-suggested mappings");
    if (correlation.unmapped.length === 0) {
      out.push("_Nothing to suggest — no unmapped paths._");
    } else {
      const ai = new AiClient({ apiKey: aiKey });
      log.info("AI: proposing mappings for unmapped paths…");
      const yaml = await ai.suggestMappings(
        correlation.unmapped.map((u) => u.path),
        folders.map((f) => f.name),
      );
      if (yaml) {
        out.push("Add these entries to `catalog-audit.yaml` (review before applying):", "");
        out.push("```yaml", yaml, "```");
      } else {
        out.push("_AI analysis unavailable._");
      }
    }
    out.push("");
  }

  const text = `${out.join("\n")}\n`;
  if (opts.out) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(resolve(opts.out)), { recursive: true });
    await writeFile(resolve(opts.out), text, "utf8");
    log.warn(`Wrote ${resolve(opts.out)}`);
  } else {
    process.stdout.write(text);
  }
  return EXIT_OK;
}
