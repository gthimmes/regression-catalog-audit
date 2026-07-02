#!/usr/bin/env node
import { Command, Option } from "commander";
import { runAreas } from "./commands/areas.js";
import { runAudit } from "./commands/audit.js";
import { runInit } from "./commands/init.js";
import { runMap } from "./commands/map.js";
import {
  ConfigError,
  CredentialError,
  EXIT_ERROR,
  RuntimeError,
} from "./errors.js";
import { configureColor } from "./output.js";

const DEFAULT_CONFIG = "catalog-audit.yaml";

function parseWindow(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`--window must be a positive integer (got "${value}")`);
  }
  return n;
}

/** Run a command action, applying global flags and mapping errors to exit codes. */
async function execute(
  cmd: Command,
  run: (globals: { config: string; verbose: boolean }) => Promise<number>,
): Promise<void> {
  const globals = cmd.optsWithGlobals() as {
    config: string;
    verbose: boolean;
    color?: boolean;
  };
  configureColor(globals.color === false);
  try {
    const code = await run({ config: globals.config, verbose: !!globals.verbose });
    process.exitCode = code;
  } catch (err) {
    handleError(err);
  }
}

function handleError(err: unknown): void {
  if (err instanceof ConfigError) {
    process.stderr.write(`Error: ${err.message}\n`);
    for (const issue of err.issues) process.stderr.write(`  - ${issue}\n`);
    process.exitCode = EXIT_ERROR;
    return;
  }
  if (err instanceof CredentialError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = EXIT_ERROR;
    return;
  }
  if (err instanceof RuntimeError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = EXIT_ERROR;
    return;
  }
  process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = EXIT_ERROR;
}

const program = new Command();

program
  .name("catalog-audit")
  .description("Audit Testiny regression catalogs against actual code activity")
  .version("1.0.0")
  .option("-c, --config <path>", "path to catalog-audit.yaml", DEFAULT_CONFIG)
  .option("--verbose", "verbose progress output", false)
  .option("--no-color", "disable colored output");

program
  .command("audit")
  .description("Run the full audit and produce a report")
  .option("--area <name>", "restrict the audit to a single configured area")
  .option("--window <days>", "override the churn window in days", parseWindow)
  .addOption(
    new Option("--format <format>", "output format")
      .choices(["md", "json", "both"])
      .default("md"),
  )
  .option("--out <dir>", "write report file(s) to a directory")
  .option("--ai", "enable AI-assisted coverage analysis", false)
  .addOption(
    new Option("--fail-on <level>", "severity gate for exit code").choices([
      "high",
      "medium",
      "low",
      "never",
    ]),
  )
  .action(async function (this: Command) {
    const opts = this.opts();
    await execute(this, (globals) =>
      runAudit({
        config: globals.config,
        verbose: globals.verbose,
        area: opts.area,
        window: opts.window,
        format: opts.format,
        out: opts.out,
        ai: !!opts.ai,
        failOn: opts.failOn,
      }),
    );
  });

program
  .command("areas")
  .description("List configured areas with resolved Testiny folders and case counts")
  .action(async function (this: Command) {
    await execute(this, (globals) => runAreas(globals));
  });

program
  .command("map")
  .description("Report path→catalog mapping health")
  .option("--ai", "propose mappings for unmapped paths via Claude", false)
  .option("--out <path>", "write the mapping report to a file")
  .action(async function (this: Command) {
    const opts = this.opts();
    await execute(this, (globals) =>
      runMap({
        config: globals.config,
        verbose: globals.verbose,
        ai: !!opts.ai,
        out: opts.out,
      }),
    );
  });

program
  .command("init")
  .description("Write a starter catalog-audit.yaml")
  .action(async function (this: Command) {
    await execute(this, (globals) => runInit(globals));
  });

program.parseAsync(process.argv).catch((err) => {
  handleError(err);
});
