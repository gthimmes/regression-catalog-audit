import { simpleGit, type SimpleGit } from "simple-git";
import { RuntimeError } from "../errors.js";

/**
 * Read-only git history access via `git log --numstat`. We NEVER check out other
 * refs (SPEC). Parsing is isolated in `parseGitLog` so it can be fixture-tested.
 */

export interface CommitFileChange {
  path: string;
  /** Additions; 0 for binary files (numstat reports "-"). */
  added: number;
  /** Deletions; 0 for binary files. */
  deleted: number;
  /** True when numstat reported "-\t-" (binary / unmergeable). */
  binary: boolean;
}

export interface Commit {
  hash: string;
  date: Date;
  subject: string;
  files: CommitFileChange[];
}

/** ASCII record/unit separators — extremely unlikely to appear in commit text. */
const RECORD_SEP = "";
const FIELD_SEP = "";

/**
 * pretty-format used with getCommits. Each commit header line is:
 *   <RS><hash><US><ISO date><US><subject>
 * followed by numstat lines: <added>\t<deleted>\t<path>
 */
export const GIT_PRETTY_FORMAT = `${RECORD_SEP}%H${FIELD_SEP}%aI${FIELD_SEP}%s`;

/** Parse raw `git log --numstat` output (in GIT_PRETTY_FORMAT) into commits. */
export function parseGitLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  let current: Commit | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith(RECORD_SEP)) {
      if (current) commits.push(current);
      const rest = line.slice(RECORD_SEP.length);
      const [hash = "", dateStr = "", ...subjectParts] = rest.split(FIELD_SEP);
      current = {
        hash,
        date: new Date(dateStr),
        subject: subjectParts.join(FIELD_SEP),
        files: [],
      };
      continue;
    }
    if (line.trim() === "" || !current) continue;

    // numstat line: added \t deleted \t path
    const firstTab = line.indexOf("\t");
    const secondTab = line.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;

    const addedRaw = line.slice(0, firstTab);
    const deletedRaw = line.slice(firstTab + 1, secondTab);
    const path = normalizeRenamePath(line.slice(secondTab + 1));
    const binary = addedRaw === "-" || deletedRaw === "-";

    current.files.push({
      path,
      added: binary ? 0 : Number.parseInt(addedRaw, 10) || 0,
      deleted: binary ? 0 : Number.parseInt(deletedRaw, 10) || 0,
      binary,
    });
  }
  if (current) commits.push(current);
  return commits;
}

/**
 * numstat represents renames as either `old => new` or `dir/{old => new}/file`.
 * We reduce to the post-rename path so churn is attributed to the current path.
 */
function normalizeRenamePath(raw: string): string {
  const path = raw.trim();
  if (!path.includes("=>")) return path;
  // Brace form: a/{b => c}/d  -> a/c/d
  const braced = path.replace(/\{[^}]*=>\s*([^}]*)\}/g, (_m, to: string) => to.trim());
  if (braced !== path) {
    return braced.replace(/\/{2,}/g, "/");
  }
  // Plain form: old => new
  const idx = path.indexOf("=>");
  return path.slice(idx + 2).trim();
}

export interface GetCommitsOptions {
  repoPath: string;
  branch?: string;
  windowDays: number;
}

/** Fetch commits within the window using simple-git (read-only). */
export async function getCommits(opts: GetCommitsOptions): Promise<Commit[]> {
  const git: SimpleGit = simpleGit({ baseDir: opts.repoPath });

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new RuntimeError(`"${opts.repoPath}" is not a git repository`);
    }
  } catch (err) {
    if (err instanceof RuntimeError) throw err;
    throw new RuntimeError(`Could not access git repository at "${opts.repoPath}"`, {
      cause: err,
    });
  }

  const args = ["log"];
  if (opts.branch) args.push(opts.branch);
  args.push(`--since=${opts.windowDays} days ago`);
  args.push("--numstat");
  args.push(`--pretty=format:${GIT_PRETTY_FORMAT}`);

  let raw: string;
  try {
    raw = await git.raw(args);
  } catch (err) {
    throw new RuntimeError(
      `git log failed${opts.branch ? ` for branch "${opts.branch}"` : ""}`,
      { cause: err },
    );
  }
  return parseGitLog(raw);
}

/** All tracked file paths (forward-slash), used for orphan existence checks. */
export async function listTrackedFiles(repoPath: string): Promise<string[]> {
  try {
    const git = simpleGit({ baseDir: repoPath });
    const raw = await git.raw(["ls-files"]);
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** Resolve the branch actually being analyzed (for the report header). */
export async function currentBranch(repoPath: string): Promise<string> {
  try {
    const git = simpleGit({ baseDir: repoPath });
    const name = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    return name || "HEAD";
  } catch {
    return "HEAD";
  }
}
