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

/** Resolve a project by numeric id or by (case-insensitive) name. */
export async function resolveProject(
  client: TestinyClient,
  projectNameOrId: string,
): Promise<TestinyProject> {
  const projects = await client.listProjects();

  const asId = Number.parseInt(projectNameOrId, 10);
  if (!Number.isNaN(asId) && String(asId) === projectNameOrId.trim()) {
    const byId = projects.find((p) => p.id === asId);
    if (byId) return byId;
  }

  const target = projectNameOrId.trim().toLowerCase();
  const byName = projects.find((p) => p.name.trim().toLowerCase() === target);
  if (byName) return byName;

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
  client: TestinyClient,
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
