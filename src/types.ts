/**
 * Shared, cross-cutting types and the finding-type taxonomy.
 *
 * The finding-type table in CLAUDE.md is the source of truth for triggers and
 * default severities; the constants here mirror it.
 */

export type Severity = "high" | "medium" | "low" | "warning";

export type FindingType =
  | "missing-catalog"
  | "coverage-gap"
  | "stale-catalog"
  | "stale-case"
  | "orphaned-case"
  | "unmapped-churn"
  | "overlapping-areas";

export interface Finding {
  type: FindingType;
  severity: Severity;
  /** Area name this finding belongs to, if area-scoped. */
  area?: string;
  message: string;
  /** Structured, machine-readable supporting detail (case ids, paths, counts). */
  evidence?: Record<string, unknown>;
  /** Optional AI-assisted advisory attached to the finding (never affects severity). */
  ai?: {
    rating?: number;
    suggestions?: string[];
    unavailable?: boolean;
  };
}

/** high > medium > low > warning */
export const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
  warning: 0,
};

export function severityAtLeast(a: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[threshold];
}

/** Returns the more-severe of the two severities. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export interface AreaReport {
  name: string;
  team: string;
  churnScore: number;
  commits: number;
  filesChanged: number;
  linesDelta: number;
  lastChangedAt: string | null;
  folderFound: boolean;
  totalCases: number;
  healthyCases: number;
  staleCases: number;
  minCases: number;
  findingsCount: number;
  worstSeverity: Severity | null;
}

export interface RunInfo {
  repo: string;
  branch: string;
  windowDays: number;
  generatedAt: string;
  status: "PASS" | "FAIL";
  aiEnabled: boolean;
}
