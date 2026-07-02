/**
 * Churn scoring — the ONLY place scoring math lives (see CLAUDE.md). Pure and
 * unit-tested; expected to be tuned over time.
 */

/** Weight applied to commits that touch more than `bulkChangeFileThreshold` files. */
export const BULK_WEIGHT = 0.25;

export interface ChurnScoreInput {
  /** Weighted commit count (bulk changes counted at BULK_WEIGHT). */
  commits: number;
  /** Weighted count of changed files attributed to the area. */
  filesChanged: number;
  /** Weighted additions + deletions. */
  linesDelta: number;
}

/**
 * Normalized composite churn score:
 *   round(commits * 3 + filesChanged + linesDelta / 100)
 * Inputs are already bulk-weighted by the caller.
 */
export function computeChurnScore(input: ChurnScoreInput): number {
  const raw = input.commits * 3 + input.filesChanged + input.linesDelta / 100;
  return Math.round(raw);
}

/** Weight for a single commit given how many files it touched in total. */
export function commitWeight(totalFilesInCommit: number, bulkThreshold: number): number {
  return totalFilesInCommit > bulkThreshold ? BULK_WEIGHT : 1;
}
