import { minimatch } from "minimatch";
import type { AreaConfig } from "../config/schema.js";
import type { Commit } from "../churn/gitlog.js";
import { commitWeight, computeChurnScore } from "../churn/score.js";

/**
 * Correlate git churn with configured areas. Produces per-area churn stats,
 * overlap detection (a path matched by >1 area), and unmapped churn (changed
 * paths matched by no area).
 */

interface MatchingCommit {
  date: Date;
  weight: number;
  /** Number of area-matching files in this commit. */
  files: number;
  /** Weighted (already) additions+deletions attributed to the area. */
  lines: number;
}

export interface AreaChurn {
  area: AreaConfig;
  commits: number; // weighted commit count
  filesChanged: number; // distinct matching files (for display)
  linesDelta: number; // weighted additions+deletions
  lastChangedAt: Date | null;
  churnScore: number;
  /** Most-recent-first commit subjects touching the area (for --ai). */
  recentSubjects: string[];
  /** Retained per-commit summaries so staleness ("churn since date") is exact. */
  matchingCommits: MatchingCommit[];
}

export interface OverlapWarning {
  path: string;
  areas: string[];
}

export interface UnmappedChurn {
  path: string;
  commits: number;
}

export interface CorrelationResult {
  areaChurn: Map<string, AreaChurn>;
  overlaps: OverlapWarning[];
  unmapped: UnmappedChurn[];
}

const MINIMATCH_OPTS = { dot: true } as const;

function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => minimatch(path, g, MINIMATCH_OPTS));
}

/** Which configured areas own a given file path (ignoring ignore-globs). */
export function areasForPath(path: string, areas: AreaConfig[]): AreaConfig[] {
  return areas.filter((a) => matchesAny(path, a.paths));
}

export interface CorrelateOptions {
  bulkChangeFileThreshold: number;
  ignore: string[];
  /** Minimum commits for an unmapped path to be reported (noise floor). */
  unmappedNoiseFloor: number;
  /** Max recent commit subjects to retain per area. */
  maxSubjects?: number;
}

export function correlateChurn(
  commits: Commit[],
  areas: AreaConfig[],
  opts: CorrelateOptions,
): CorrelationResult {
  const maxSubjects = opts.maxSubjects ?? 30;

  const areaChurn = new Map<string, AreaChurn>();
  for (const area of areas) {
    areaChurn.set(area.name, {
      area,
      commits: 0,
      filesChanged: 0,
      linesDelta: 0,
      lastChangedAt: null,
      churnScore: 0,
      recentSubjects: [],
      matchingCommits: [],
    });
  }

  const distinctFilesByArea = new Map<string, Set<string>>();
  for (const area of areas) distinctFilesByArea.set(area.name, new Set());

  const overlapByPath = new Map<string, Set<string>>();
  const unmappedCommitCount = new Map<string, number>();

  // Commits come newest-first from git log.
  for (const commit of commits) {
    const weight = commitWeight(commit.files.length, opts.bulkChangeFileThreshold);

    // Track which areas this commit contributed to (for weighted commit count).
    const perAreaFilesInCommit = new Map<string, { files: number; lines: number }>();
    const unmappedThisCommit = new Set<string>();

    for (const file of commit.files) {
      if (matchesAny(file.path, opts.ignore)) continue;

      const owners = areasForPath(file.path, areas);
      if (owners.length === 0) {
        unmappedThisCommit.add(file.path);
        continue;
      }
      if (owners.length > 1) {
        const set = overlapByPath.get(file.path) ?? new Set<string>();
        for (const o of owners) set.add(o.name);
        overlapByPath.set(file.path, set);
      }

      const lines = file.added + file.deleted;
      for (const owner of owners) {
        const acc = perAreaFilesInCommit.get(owner.name) ?? { files: 0, lines: 0 };
        acc.files += 1;
        acc.lines += lines;
        perAreaFilesInCommit.set(owner.name, acc);
        distinctFilesByArea.get(owner.name)?.add(file.path);
      }
    }

    for (const path of unmappedThisCommit) {
      unmappedCommitCount.set(path, (unmappedCommitCount.get(path) ?? 0) + 1);
    }

    for (const [areaName, acc] of perAreaFilesInCommit) {
      const ac = areaChurn.get(areaName);
      if (!ac) continue;
      ac.commits += weight;
      ac.linesDelta += weight * acc.lines;
      ac.matchingCommits.push({
        date: commit.date,
        weight,
        files: acc.files,
        lines: acc.lines,
      });
      if (!ac.lastChangedAt || commit.date > ac.lastChangedAt) {
        ac.lastChangedAt = commit.date;
      }
      if (ac.recentSubjects.length < maxSubjects) {
        ac.recentSubjects.push(commit.subject);
      }
    }
  }

  // Finalize distinct file counts and scores.
  for (const [name, ac] of areaChurn) {
    ac.filesChanged = distinctFilesByArea.get(name)?.size ?? 0;
    ac.churnScore = computeChurnScore({
      commits: ac.commits,
      filesChanged: weightedFilesChanged(ac.matchingCommits),
      linesDelta: ac.linesDelta,
    });
  }

  const overlaps: OverlapWarning[] = [...overlapByPath.entries()]
    .map(([path, set]) => ({ path, areas: [...set].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const unmapped: UnmappedChurn[] = [...unmappedCommitCount.entries()]
    .filter(([, count]) => count > opts.unmappedNoiseFloor)
    .map(([path, commitsCount]) => ({ path, commits: commitsCount }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path));

  return { areaChurn, overlaps, unmapped };
}

/** Weighted files-changed used inside the score (bulk commits contribute less). */
function weightedFilesChanged(matching: MatchingCommit[]): number {
  return matching.reduce((sum, c) => sum + c.weight * c.files, 0);
}

/**
 * Churn score accumulated by an area strictly after `since`. Used for staleness.
 * Uses the same weighting as the overall score for consistency.
 */
export function churnScoreSince(area: AreaChurn, since: Date): number {
  let commits = 0;
  let files = 0;
  let lines = 0;
  for (const c of area.matchingCommits) {
    if (c.date > since) {
      commits += c.weight;
      files += c.weight * c.files;
      lines += c.weight * c.lines;
    }
  }
  return computeChurnScore({ commits, filesChanged: files, linesDelta: lines });
}
