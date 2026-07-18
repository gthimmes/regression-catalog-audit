# Catalog Snapshot — how to regenerate

The **snapshot** is the styled `audit-report.html` inventory of Testiny catalogs
(case counts, legacy/parked folders, automation coverage). It is separate from the
`catalog-audit audit` command, which does the churn-correlated audit and needs a
product repo + `catalog-audit.yaml`.

## Why there are two steps

Data is pulled through Claude's **Testiny connector**, which uses interactive
sign-in and can't run headless. So the pull is done by Claude; everything after it
is a deterministic program (`scripts/build-snapshot.mjs`) that always renders the
same report from the same data. To regenerate, just tell Claude:

> **"regenerate the catalog snapshot"**

Claude then does the two steps below.

## Step 1 — pull the data (Claude, via connector)

For each in-scope project, call the Testiny "list test cases" tool and save the raw
`{ "testCases": [...] }` result to `data/testiny/p<projectId>.json`.

- In-scope project IDs come from `snapshot.config.json` (`projects` minus
  `excludeProjects`). As of the last run: **7, 8, 9, 10, 11, 12, 14, 17**.
- Large results are written to a file by the tool automatically — copy that file to
  the matching `p<id>.json`. Small results returned inline get written directly.
- `data/testiny/` is git-ignored; it is scratch input, overwritten each run.

## Step 2 — render (deterministic)

```bash
npm run snapshot
```

Writes `audit-report.html` and prints a one-line summary. Open the file in any
browser (it is fully self-contained — no network, no Claude).

Each run also records a per-project summary in `data/history.json` (committed,
one entry per date — rerunning a date replaces its entry) and the report shows
deltas vs the previous run: change chips on the summary cards and a Δ column
in the projects table.

Pin the header date for a reproducible diff:

```bash
SNAPSHOT_DATE=2026-07-15 npm run snapshot     # bash
$env:SNAPSHOT_DATE="2026-07-15"; npm run snapshot   # PowerShell
```

## Configuring it — `snapshot.config.json`

| Key | Meaning |
|---|---|
| `output` | Output HTML path (default `audit-report.html`) |
| `dataDir` | Where the `p<id>.json` dumps live (default `data/testiny`) |
| `excludeProjects` | Project **names** to drop from totals, table, and findings |
| `legacyFolderPatterns` | Case-insensitive regexes; a top-level folder matching any is counted "legacy / parked" |
| `legacyFindingThresholdPct` | A project appears in the legacy finding when its legacy share ≥ this |
| `projects` | `id → { name, key }` map for every known project |

To add or retire a team, edit `projects` / `excludeProjects` and pull its data file.
No code change needed.
