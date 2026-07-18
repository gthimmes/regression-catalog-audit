import { RuntimeError } from "../errors.js";
import type {
  TestinyClient,
  TestinyCase,
  TestinyFolder,
  TestinyProject,
} from "./client.js";

/**
 * Project / folder / case resolution on top of the raw client. Folder matching
 * is case-insensitive and supports nested paths ("Parent/Child").
 */

/** The read surface of TestinyClient this module needs (fakeable in tests). */
export type TestinyReader = Pick<
  TestinyClient,
  "listProjects" | "listFolders" | "listCasesInFolder" | "listCasesInProject"
>;

/** Match a project by numeric id or (case-insensitive) name; null if absent. */
export function matchProject(
  projects: TestinyProject[],
  projectNameOrId: string,
): TestinyProject | null {
  const asId = Number.parseInt(projectNameOrId, 10);
  if (!Number.isNaN(asId) && String(asId) === projectNameOrId.trim()) {
    const byId = projects.find((p) => p.id === asId);
    if (byId) return byId;
  }

  const target = projectNameOrId.trim().toLowerCase();
  return projects.find((p) => p.name.trim().toLowerCase() === target) ?? null;
}

/** Resolve a project by numeric id or by (case-insensitive) name. */
export async function resolveProject(
  client: TestinyReader,
  projectNameOrId: string,
): Promise<TestinyProject> {
  const projects = await client.listProjects();
  const match = matchProject(projects, projectNameOrId);
  if (match) return match;

  throw new RuntimeError(
    `Testiny project "${projectNameOrId}" not found. Available: ${
      projects.map((p) => p.name).join(", ") || "(none)"
    }`,
  );
}

/**
 * Resolve an area's configured folder path within the project's folder tree.
 * Returns null (not an error) when not found — the caller turns that into a
 * `missing-catalog` finding.
 */
export function resolveFolder(
  folders: TestinyFolder[],
  folderPath: string,
): TestinyFolder | null {
  const segments = folderPath
    .split("/")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  let parentId: number | null = null;
  let match: TestinyFolder | null = null;

  for (const segment of segments) {
    match =
      folders.find(
        (f) => f.parentId === parentId && f.name.trim().toLowerCase() === segment,
      ) ?? null;
    // Fall back to a name-only match if the tree isn't strictly nested.
    if (!match && segments.length === 1) {
      match = folders.find((f) => f.name.trim().toLowerCase() === segment) ?? null;
    }
    if (!match) return null;
    parentId = match.id;
  }
  return match;
}

/** All descendant folder ids (inclusive) of a folder. */
export function descendantFolderIds(
  folders: TestinyFolder[],
  rootId: number,
): number[] {
  const childrenByParent = new Map<number, TestinyFolder[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const list = childrenByParent.get(f.parentId) ?? [];
    list.push(f);
    childrenByParent.set(f.parentId, list);
  }

  const result: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const id = stack.pop() as number;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child.id);
  }
  return result;
}

/** Fetch all cases within a folder, recursively including subfolders. */
export async function getCasesForFolder(
  client: TestinyReader,
  projectId: number,
  folders: TestinyFolder[],
  folder: TestinyFolder,
): Promise<TestinyCase[]> {
  const ids = descendantFolderIds(folders, folder.id);
  const all: TestinyCase[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const cases = await client.listCasesInFolder(projectId, id);
    for (const c of cases) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
  }
  return all;
}

/* ------------------------------------------------------------------ *
 * Multi-project area resolution (shared by audit / areas / map).
 * ------------------------------------------------------------------ */

/** What an area asks for: its project (or the default) and optional folder. */
export interface AreaCatalogQuery {
  name: string;
  project?: string | undefined;
  folder?: string | undefined;
}

/** The resolved catalog for one area. */
export interface AreaCatalog {
  /** Configured project reference (area override or top-level default). */
  projectRef: string;
  /** Resolved project, or null when a per-area override didn't match. */
  project: TestinyProject | null;
  /** Human label: folder path, or "(entire project)" when no folder is set. */
  folderLabel: string;
  /** False when the project or folder could not be resolved → missing-catalog. */
  folderFound: boolean;
  cases: TestinyCase[];
}

export interface ResolvedAreaCatalogs {
  byArea: Map<string, AreaCatalog>;
  /** Distinct folder names across every resolved project (for AI suggestions). */
  folderNames: string[];
}

/**
 * Resolve each area's project + folder + cases. Areas may target different
 * Testiny projects (one-project-per-team layouts) via `testiny.project`; an
 * omitted folder maps the area to the entire project.
 *
 * Error semantics: a top-level default project that doesn't resolve throws
 * (config error — the whole run is misconfigured); a per-area override that
 * doesn't resolve becomes `folderFound: false` (missing-catalog) so one
 * renamed team project doesn't kill the audit for everyone else.
 */
export async function resolveAreaCatalogs(
  client: TestinyReader,
  queries: AreaCatalogQuery[],
  opts: { defaultProject?: string | undefined; warn?: (msg: string) => void } = {},
): Promise<ResolvedAreaCatalogs> {
  const warn = opts.warn ?? (() => {});
  const projects = await client.listProjects();

  // Resolve each distinct project reference once.
  const resolved = new Map<string, TestinyProject | null>();
  const foldersByProject = new Map<number, TestinyFolder[]>();
  for (const q of queries) {
    const ref = q.project ?? opts.defaultProject;
    if (!ref) {
      throw new RuntimeError(
        `Area "${q.name}" has no Testiny project and no top-level default is set.`,
      );
    }
    if (resolved.has(ref)) continue;

    const project = matchProject(projects, ref);
    if (!project) {
      if (ref === opts.defaultProject) {
        throw new RuntimeError(
          `Testiny project "${ref}" not found. Available: ${
            projects.map((p) => p.name).join(", ") || "(none)"
          }`,
        );
      }
      warn(`Testiny project "${ref}" not found (area "${q.name}")`);
      resolved.set(ref, null);
      continue;
    }
    resolved.set(ref, project);
    if (!foldersByProject.has(project.id)) {
      foldersByProject.set(project.id, await client.listFolders(project.id));
    }
  }

  const byArea = new Map<string, AreaCatalog>();
  for (const q of queries) {
    const ref = (q.project ?? opts.defaultProject) as string;
    const project = resolved.get(ref) ?? null;
    const folderLabel = q.folder ?? "(entire project)";

    if (!project) {
      byArea.set(q.name, { projectRef: ref, project, folderLabel, folderFound: false, cases: [] });
      continue;
    }

    if (!q.folder) {
      const cases = await client.listCasesInProject(project.id);
      byArea.set(q.name, { projectRef: ref, project, folderLabel, folderFound: true, cases });
      continue;
    }

    const folders = foldersByProject.get(project.id) ?? [];
    const folder = resolveFolder(folders, q.folder);
    if (!folder) {
      warn(`Folder "${q.folder}" not found in project "${project.name}" (area "${q.name}")`);
      byArea.set(q.name, { projectRef: ref, project, folderLabel, folderFound: false, cases: [] });
      continue;
    }
    const cases = await getCasesForFolder(client, project.id, folders, folder);
    byArea.set(q.name, { projectRef: ref, project, folderLabel: folder.name, folderFound: true, cases });
  }

  const folderNames = [
    ...new Set([...foldersByProject.values()].flat().map((f) => f.name)),
  ];
  return { byArea, folderNames };
}
