import type { TestinyCase } from "../testiny/client.js";
import type { Finding } from "../types.js";

/**
 * Orphan detection: test cases whose title/description reference a file path or
 * URL route that no longer exists in the repo. Extraction and detection are pure
 * (existence is injected) so both are unit-testable without a filesystem.
 */

export interface Reference {
  token: string;
  kind: "path" | "route";
}

// A file-path-like token: at least one slash and a file extension.
const PATH_RE = /(?<![\w@/.])[\w.-]*[\w-](?:\/[\w.-]+)+\.[a-zA-Z][a-zA-Z0-9]{0,5}\b/g;
// A URL-route-like token: leading slash, lowercase segment(s), no extension.
const ROUTE_RE = /(?<![\w./])\/[a-z][a-z0-9_-]*(?:\/[a-z0-9_:{}-]+)*\b/g;

/** Extract path-like and route-like references from free text. */
export function extractReferences(text: string): Reference[] {
  if (!text) return [];
  const refs: Reference[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(PATH_RE)) {
    const token = m[0];
    const key = `path:${token}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ token, kind: "path" });
    }
  }
  for (const m of text.matchAll(ROUTE_RE)) {
    const token = m[0];
    // Skip anything that already looks like a file path (has an extension).
    if (/\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(token)) continue;
    const key = `route:${token}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ token, kind: "route" });
    }
  }
  return refs;
}

export type ReferenceExists = (ref: Reference) => boolean;

/**
 * Produce one `orphaned-case` finding per case that references something no
 * longer present. `exists` returns true when the reference still resolves.
 */
export function detectOrphans(cases: TestinyCase[], exists: ReferenceExists): Finding[] {
  const findings: Finding[] = [];

  for (const c of cases) {
    const text = `${c.title}\n${c.description ?? ""}`;
    const refs = extractReferences(text);
    if (refs.length === 0) continue;

    const missing = refs.filter((ref) => !exists(ref));
    if (missing.length === 0) continue;

    findings.push({
      type: "orphaned-case",
      severity: "medium",
      message: `Case #${c.id} "${c.title}" references ${missing.length} path/route(s) that no longer exist in the repo`,
      evidence: {
        caseId: c.id,
        title: c.title,
        missing: missing.map((m) => ({ token: m.token, kind: m.kind })),
      },
    });
  }
  return findings;
}
