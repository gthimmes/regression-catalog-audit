#!/usr/bin/env node
/**
 * build-snapshot.mjs — deterministic catalog snapshot renderer.
 *
 * Reads per-project Testiny case dumps from the configured dataDir (one file per
 * project, named p<projectId>.json, each holding the raw {testCases:[...]} shape
 * the Testiny "list test cases" call returns) and renders a self-contained HTML
 * report. All aggregation, exclusion, and layout logic lives here so the report
 * regenerates identically every run — the only non-scriptable step is the data
 * pull, which the connector does interactively (see SNAPSHOT.md).
 *
 * Usage:  node scripts/build-snapshot.mjs [path/to/snapshot.config.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "snapshot.config.json");
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const dataDir = isAbsolute(cfg.dataDir) ? cfg.dataDir : join(ROOT, cfg.dataDir);
const legacyRes = cfg.legacyFolderPatterns.map((p) => new RegExp(p, "i"));
const excluded = new Set(cfg.excludeProjects);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (n) => n.toLocaleString("en-US");
const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));
const topFolder = (f) => (f ? String(f).split(">")[0].trim() : "(none)");
const isLegacy = (folder) => legacyRes.some((re) => re.test(folder));

// ---- Load + aggregate per project ------------------------------------------
const projects = [];
for (const [id, meta] of Object.entries(cfg.projects)) {
  if (excluded.has(meta.name)) continue;
  const file = join(dataDir, `p${id}.json`);
  if (!existsSync(file)) {
    console.warn(`! skipping ${meta.name} (P-${id}): no data file at ${file}`);
    continue;
  }
  const cases = JSON.parse(readFileSync(file, "utf8")).testCases ?? [];
  const folders = {};
  let legacy = 0, automated = 0, untyped = 0, other = 0;
  for (const c of cases) {
    const tf = topFolder(c.folder);
    folders[tf] = (folders[tf] || 0) + 1;
    if (isLegacy(tf)) legacy++;
    if (c.automationstatus === "Automated") automated++;
    if (c.testcase_type == null) untyped++;
    else if (c.testcase_type === "OTHER") other++;
  }
  const notable = Object.entries(folders).sort((a, b) => b[1] - a[1]).slice(0, 2);
  projects.push({
    id, name: meta.name, key: meta.key, total: cases.length,
    legacy, automated, untyped, other, folders, notable,
    autoPct: pct(automated, cases.length),
  });
}
projects.sort((a, b) => b.total - a.total);

if (projects.length === 0) {
  console.error("No in-scope project data found. Populate", dataDir, "and retry.");
  process.exit(1);
}

// ---- Roll-ups ---------------------------------------------------------------
const totalCases = projects.reduce((s, p) => s + p.total, 0);
const totalAuto = projects.reduce((s, p) => s + p.automated, 0);
const totalLegacy = projects.reduce((s, p) => s + p.legacy, 0);
const zeroAuto = projects.filter((p) => p.total > 0 && p.automated === 0);

const legacyLeaders = projects
  .filter((p) => pct(p.legacy, p.total) >= cfg.legacyFindingThresholdPct)
  .sort((a, b) => pct(b.legacy, b.total) - pct(a.legacy, a.total));

const untypedLeaders = projects
  .map((p) => ({ ...p, tagGap: p.untyped + p.other }))
  .sort((a, b) => b.tagGap - a.tagGap)
  .slice(0, 2)
  .filter((p) => p.tagGap > 0);

// ---- Render -----------------------------------------------------------------
const genDate = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);

const barClass = (p) => (p.autoPct === 0 ? "bar zero" : p.autoPct < 40 ? "bar lowfill" : "bar");

const rows = projects.map((p) => {
  const notable = p.notable.map(([name, n]) =>
    `${isLegacy(name) ? "<b>" : ""}${esc(name)} (${num(n)})${isLegacy(name) ? "</b>" : ""}`).join(", ");
  return `        <tr><td>${esc(p.name)}</td><td>${esc(p.key)}</td><td class="num">${num(p.total)}</td>` +
    `<td class="num${p.legacy > 0 ? " legacy-hi" : ""}">${num(p.legacy)}</td>` +
    `<td><span class="${barClass(p)}"><span style="width:${p.autoPct}%"></span></span>` +
    `<span class="pct">${p.autoPct}%</span></td><td>${notable}</td></tr>`;
}).join("\n");

const legacyItems = legacyLeaders.map((p) => {
  const [name, n] = p.notable.find(([nm]) => isLegacy(nm)) || p.notable[0];
  return `      <li><b>${esc(p.name)}:</b> ${num(p.legacy)} of ${num(p.total)} ` +
    `(<b>${pct(p.legacy, p.total)}%</b>) parked in <code>${esc(name)}</code></li>`;
}).join("\n");

const activeNote = legacyLeaders.map((p) => `${esc(p.name)} ~${num(p.total - p.legacy)}`).join(", ");

const zeroList = zeroAuto.map((p) => `<b>${esc(p.name)}</b> (${num(p.total)})`).join(" and ");
const autoLeaders = [...projects].sort((a, b) => b.autoPct - a.autoPct).slice(0, 2)
  .map((p) => `<b>${esc(p.name)}</b> (${p.autoPct}%)`).join(" and ");

const tagItems = untypedLeaders.map((p) => {
  const which = p.untyped >= p.other ? `${num(p.untyped)} unset` : `${num(p.other)} <code>OTHER</code>`;
  return `${esc(p.name)} ${which}`;
}).join(", ");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.title)}</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #ffffff; --ink: #1c2128; --muted: #656d76;
    --line: #d8dee4; --accent: #2563eb; --med: #bf8700; --low: #57606a;
    --good: #1a7f37; --track: #eaeef2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --card: #161b22; --ink: #e6edf3; --muted: #8b949e;
      --line: #30363d; --accent: #4c8dff; --med: #e3b341; --low: #8b949e;
      --good: #3fb950; --track: #21262d;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
  header h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  header .sub { color: var(--muted); font-size: 14px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 16px 0 4px; font-size: 13px; color: var(--muted); }
  .meta b { color: var(--ink); font-weight: 600; }
  .note { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 8px; padding: 14px 16px; margin: 24px 0; font-size: 13.5px; color: var(--muted); }
  .note b { color: var(--ink); }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 24px 0; }
  @media (max-width: 640px) { .cards { grid-template-columns: repeat(2, 1fr); } }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .stat .n { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .stat .l { font-size: 12px; color: var(--muted); margin-top: 2px; }
  h2 { font-size: 17px; margin: 40px 0 14px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .tablescroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { padding: 9px 12px; text-align: left; white-space: nowrap; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted);
    border-bottom: 1px solid var(--line); font-weight: 600; }
  td { border-bottom: 1px solid var(--track); }
  tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .legacy-hi { color: var(--med); font-weight: 600; }
  .bar { position: relative; width: 120px; height: 16px; background: var(--track); border-radius: 4px;
    overflow: hidden; display: inline-block; vertical-align: middle; }
  .bar > span { position: absolute; left: 0; top: 0; bottom: 0; background: var(--good); border-radius: 4px; }
  .bar.lowfill > span { background: var(--med); }
  .bar.zero > span { background: transparent; }
  .pct { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; margin-left: 8px; }
  .legend { display: grid; gap: 6px; margin: 12px 2px 0; font-size: 12.5px; color: var(--muted); }
  .legend b { color: var(--ink); font-weight: 600; }
  .finding { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin: 12px 0; }
  .finding h3 { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .sev { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 2px 7px; border-radius: 999px; color: #fff; }
  .sev.med { background: var(--med); } .sev.low { background: var(--low); }
  .finding p, .finding ul { margin: 6px 0; font-size: 13.5px; color: var(--ink); }
  .finding ul { padding-left: 20px; } .finding li { margin: 3px 0; }
  .finding .muted { color: var(--muted); font-size: 12.5px; }
  code { background: var(--track); padding: 1px 5px; border-radius: 4px; font-size: 12px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(cfg.title)}</h1>
    <div class="sub">${esc(cfg.subtitle)}</div>
    <div class="meta">
      <span><b>Source:</b> Testiny (live)</span>
      <span><b>Generated:</b> ${esc(genDate)}</span>
      <span><b>Scope:</b> ${projects.length} in-scope team projects</span>
    </div>
  </header>

  <div class="note">
    <b>Scope note.</b> Live inventory of what exists in Testiny today, not a churn-correlated audit.
    The Testiny API surface used here returns no create/modify timestamps, so staleness is inferred
    from folder naming, and no product git repo is attached to correlate churn against.
    <b>Excluded by configuration:</b> ${esc(cfg.excludeProjects.join(", "))}.
  </div>

  <div class="cards">
    <div class="stat"><div class="n">${num(totalCases)}</div><div class="l">Test cases (${projects.length} projects)</div></div>
    <div class="stat"><div class="n">${num(totalAuto)}</div><div class="l">Automated (${pct(totalAuto, totalCases)}%)</div></div>
    <div class="stat"><div class="n">${num(totalLegacy)}</div><div class="l">Legacy / parked (${pct(totalLegacy, totalCases)}%)</div></div>
    <div class="stat"><div class="n">${zeroAuto.length}</div><div class="l">Projects at 0% automation</div></div>
  </div>

  <h2>Projects</h2>
  <div class="card tablescroll">
    <table>
      <thead>
        <tr><th>Project</th><th>Key</th><th class="num">Cases</th>
          <th class="num">Legacy&nbsp;(parked)</th><th>Automation</th><th>Notable folders</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
  <div class="legend">
    <div><b>Cases</b> — all test cases currently in the project, across every folder.</div>
    <div><b>Legacy (parked)</b> — cases in folders explicitly named historical / old / deprecated.
      A staleness proxy: the API exposes no last-modified date, so this counts what the team has
      itself flagged as archived. High values mean the live total overstates active coverage.</div>
    <div><b>Automation</b> — share of the project's cases whose Testiny <i>Automation Status</i> is <code>Automated</code>.</div>
  </div>

  <h2>Findings</h2>

  <div class="finding">
    <h3><span class="sev med">Medium</span> Large legacy / parked buckets (staleness proxy)</h3>
    <p>~<b>${num(totalLegacy)} cases (${pct(totalLegacy, totalCases)}% of in-scope)</b> sit in folders
       explicitly named historical, old, or deprecated. Where the archive dwarfs the active catalog:</p>
    <ul>
${legacyItems}
    </ul>
    <p class="muted">Separating these would drop the "active" counts to roughly ${activeNote}.</p>
  </div>

  <div class="finding">
    <h3><span class="sev med">Medium</span> Automation gaps</h3>
    <p>${zeroList || "No projects"} at <b>0%</b> automation. Automation is concentrated in ${autoLeaders}.</p>
  </div>

  <div class="finding">
    <h3><span class="sev low">Low</span> Untyped cases</h3>
    <p>Case <i>Type</i> is set inconsistently — large blocks are unset or <code>OTHER</code>
       (${tagItems}). Metadata hygiene, not a coverage gap, but it makes filtering true regression cases unreliable.</p>
  </div>

  <footer>
    <b>Caveats.</b> No churn correlation (needs product repo + a <code>catalog-audit.yaml</code> mapping
    code paths → projects). No timestamps from this API surface, so "legacy" is inferred from folder
    naming. Excludes ${esc(cfg.excludeProjects.join(", "))} per configuration.
  </footer>
</div>
</body>
</html>
`;

const outPath = isAbsolute(cfg.output) ? cfg.output : join(ROOT, cfg.output);
writeFileSync(outPath, html);
console.log(`Rendered ${outPath}`);
console.log(`  ${projects.length} projects, ${num(totalCases)} cases, ` +
  `${num(totalAuto)} automated (${pct(totalAuto, totalCases)}%), ${num(totalLegacy)} legacy (${pct(totalLegacy, totalCases)}%)`);
