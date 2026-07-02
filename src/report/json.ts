import type { AreaReport, Finding, RunInfo } from "../types.js";

/**
 * Machine-readable JSON report — the CI/automation contract. Any breaking change
 * to this shape MUST bump `schemaVersion` (see CLAUDE.md / README).
 */

export const JSON_SCHEMA_VERSION = 1 as const;

export interface JsonReport {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  runInfo: RunInfo;
  areas: AreaReport[];
  findings: Finding[];
}

export function buildJsonReport(
  runInfo: RunInfo,
  areas: AreaReport[],
  findings: Finding[],
): JsonReport {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    runInfo,
    areas,
    findings,
  };
}

export function renderJsonReport(report: JsonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
