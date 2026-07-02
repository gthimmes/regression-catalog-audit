import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { ConfigError } from "../errors.js";
import { type Config, configSchema } from "./schema.js";

/** Format a ZodError into `path: message` lines for actionable output. */
export function formatZodIssues(err: ZodError): string[] {
  return err.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

/** Validate an already-parsed object against the config schema. */
export function validateConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      "Invalid catalog-audit configuration",
      formatZodIssues(result.error),
    );
  }
  return result.data;
}

/** Read, YAML-parse, and validate a config file. Throws ConfigError on failure. */
export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(
      `Could not read config file at "${path}". Pass --config or run \`catalog-audit init\`.`,
      [err instanceof Error ? err.message : String(err)],
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new ConfigError(`Could not parse YAML in "${path}"`, [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  return validateConfig(parsed);
}
