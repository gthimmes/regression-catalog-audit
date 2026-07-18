/**
 * snapshot-lib.mjs — pure aggregation/history logic for the catalog snapshot.
 * No filesystem access here; build-snapshot.mjs wires in config + IO. Kept
 * separate so it is unit-testable (test/snapshot/snapshot-lib.test.ts).
 */

export const topFolder = (f) => (f ? String(f).split(">")[0].trim() : "(none)");

export function makeLegacyMatcher(patterns) {
  const res = patterns.map((p) => new RegExp(p, "i"));
  return (folder) => res.some((re) => re.test(folder));
}

/** Aggregate one project's raw testCases into the summary the report renders. */
export function summarizeProject(cases, isLegacy) {
  const folders = {};
  let legacy = 0;
  let automated = 0;
  let untyped = 0;
  let other = 0;
  for (const c of cases) {
    const tf = topFolder(c.folder);
    folders[tf] = (folders[tf] || 0) + 1;
    if (isLegacy(tf)) legacy++;
    if (c.automationstatus === "Automated") automated++;
    if (c.testcase_type == null) untyped++;
    else if (c.testcase_type === "OTHER") other++;
  }
  const notable = Object.entries(folders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  return { total: cases.length, legacy, automated, untyped, other, folders, notable };
}

export function computeTotals(projects) {
  return {
    total: projects.reduce((s, p) => s + p.total, 0),
    automated: projects.reduce((s, p) => s + p.automated, 0),
    legacy: projects.reduce((s, p) => s + p.legacy, 0),
  };
}

/** History entry for one run. `projects` is keyed by project id. */
export function makeHistoryEntry(date, projects) {
  const byId = {};
  for (const p of projects) {
    byId[p.id] = { name: p.name, total: p.total, automated: p.automated, legacy: p.legacy };
  }
  return { date, totals: computeTotals(projects), projects: byId };
}

/**
 * Insert/replace `entry` in date-sorted history. A rerun on the same date
 * replaces that date's entry rather than appending a duplicate.
 */
export function upsertHistory(history, entry) {
  const rest = history.filter((h) => h.date !== entry.date);
  return [...rest, entry].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The most recent entry strictly before `date`, or null. */
export function previousEntry(history, date) {
  const before = history.filter((h) => h.date < date);
  return before.length > 0 ? before[before.length - 1] : null;
}

/**
 * Deltas of the current run vs a previous history entry. Returns null when
 * there is no previous entry (first run). Per-project deltas are keyed by id;
 * a project absent from the previous entry gets `isNew: true`.
 */
export function computeDeltas(current, prev) {
  if (!prev) return null;
  const perProject = {};
  for (const p of current) {
    const old = prev.projects[p.id];
    perProject[p.id] = old
      ? {
          total: p.total - old.total,
          automated: p.automated - old.automated,
          legacy: p.legacy - old.legacy,
          isNew: false,
        }
      : { total: p.total, automated: p.automated, legacy: p.legacy, isNew: true };
  }
  const totals = computeTotals(current);
  return {
    since: prev.date,
    totals: {
      total: totals.total - prev.totals.total,
      automated: totals.automated - prev.totals.automated,
      legacy: totals.legacy - prev.totals.legacy,
    },
    perProject,
  };
}

/** Format a signed delta for display: 0 → "±0", 12 → "+12", -3 → "−3". */
export function fmtDelta(n) {
  if (n === 0) return "±0";
  return n > 0 ? `+${n.toLocaleString("en-US")}` : `−${Math.abs(n).toLocaleString("en-US")}`;
}
