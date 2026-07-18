import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { simpleGit } from "simple-git";
import { EXIT_OK, RuntimeError } from "../errors.js";
import { makeLogger } from "../output.js";

/**
 * `catalog-audit init` — detects the git repo, prompts for the Testiny project,
 * and writes a starter catalog-audit.yaml with commented examples.
 */

export interface InitOptions {
  config: string;
  verbose: boolean;
}

export async function runInit(opts: InitOptions): Promise<number> {
  const log = makeLogger(opts.verbose);
  const target = resolve(opts.config);

  if (existsSync(target)) {
    const overwrite = await prompt(
      `${opts.config} already exists. Overwrite? [y/N] `,
      "n",
    );
    if (!/^y(es)?$/i.test(overwrite.trim())) {
      log.warn("Aborted; existing config left untouched.");
      return EXIT_OK;
    }
  }

  let isRepo = false;
  try {
    isRepo = await simpleGit().checkIsRepo();
  } catch {
    isRepo = false;
  }
  if (!isRepo) {
    log.warn("Warning: current directory does not look like a git repository.");
  } else {
    log.info("Detected a git repository.");
  }

  const project = (await prompt("Testiny project name or ID: ", "Regression Catalogs")).trim();

  const yaml = starterYaml(project || "Regression Catalogs");
  await writeFile(target, yaml, "utf8");
  process.stdout.write(`Wrote ${target}\n`);
  process.stdout.write("Edit the `areas` section to map your code paths to catalog folders, then run `catalog-audit areas`.\n");
  return EXIT_OK;
}

async function prompt(question: string, fallback: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return answer.length > 0 ? answer : fallback;
  } catch (err) {
    throw new RuntimeError("Failed to read input", { cause: err });
  } finally {
    rl.close();
  }
}

/** Exported for tests: the starter template must always validate. */
export function starterYaml(project: string): string {
  return `version: 1

repo:
  # Path to the git repo to analyze. Defaults to the current directory.
  path: .
  # Branch to analyze. Defaults to the current branch.
  # branch: main

churn:
  # How far back to look for "recent" changes.
  windowDays: 90
  # Commits touching more than this many files are treated as bulk changes
  # (formatting, codemods) and weighted at 0.25.
  bulkChangeFileThreshold: 50
  # Paths always ignored for churn purposes.
  ignore:
    - "**/*.md"
    - "**/package-lock.json"
    - "**/*.snap"

testiny:
  # Default Testiny project (name or ID) for areas that don't set their own.
  # Optional if every area sets its own testiny.project below.
  project: ${JSON.stringify(project)}

areas:
  # Map each ownership area's code paths to its Testiny catalog.
  - name: example-area
    team: ExampleTeam
    paths:
      - "apps/example/**"
      - "libs/example/**"
    testiny:
      # Folder path within the Testiny project (matched case-insensitively).
      folder: "Example"
    # Optional: minimum healthy (mapped, non-stale) cases for this area. Default 1.
    # minCases: 10

  # One-project-per-team Testiny layouts: give the area its own project.
  # Omitting \`folder\` maps the area to the entire project.
  # - name: example-team-area
  #   team: ExampleTeam2
  #   paths:
  #     - "apps/example2/**"
  #   testiny:
  #     project: "Example Team Project"

thresholds:
  # An area is a COVERAGE GAP if churnScore >= gapChurnScore and healthy
  # (non-stale) mapped cases < minCases.
  gapChurnScore: 50
  # A case is STALE if its area accrued >= staleChurnScore of churn since the
  # case was last updated in Testiny.
  staleChurnScore: 100
  # Findings at or above this severity fail the audit (exit 1).
  # one of: high | medium | low | never
  failOn: high
`;
}
