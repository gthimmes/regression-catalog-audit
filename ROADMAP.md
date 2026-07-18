# Roadmap

State of the system and where it's going. Updated 2026-07-18.

## Done

- **Core CLI** (`catalog-audit`): churn-correlated audit of Testiny catalogs —
  `audit` / `areas` / `map` / `init`, 7 finding types, Markdown + JSON + exit
  codes. Fully config-driven; no team data in shipping code.
- **Per-area Testiny projects** (`areas[].testiny.project`, optional `folder`):
  supports one-project-per-team Testiny layouts like ours. A missing per-team
  project degrades to `missing-catalog` instead of failing the run.
- **Catalog snapshot** (`npm run snapshot`): styled, self-contained
  `audit-report.html` inventory (case counts, legacy/parked folders, automation
  coverage) rendered deterministically from `data/testiny/p<id>.json` dumps.
  Data pull happens through Claude's Testiny connector (interactive auth);
  see `SNAPSHOT.md`. Excluded projects and legacy-folder patterns live in
  `snapshot.config.json`.

## Done (2026-07-18 autonomous session)

- **Snapshot trend history**: each run upserts a per-project summary into
  `data/history.json` (committed) and the HTML renders deltas vs the previous
  run (summary-card chips + Δ column). Aggregation extracted into
  `scripts/snapshot-lib.mjs` with unit tests. History seeded with the
  2026-07-15 run, so the next data refresh produces real deltas.
- **`catalog-audit.draft.yaml`**: the 8 in-scope teams as areas with per-team
  `testiny.project` (validated against the real schema); path globs are TODO
  until product repos are identified. Billing & AR and Engagement Letters point
  at their active folders so historical archives don't count as coverage.
- **`init` starter YAML** documents per-area projects / optional folder, with a
  test that the template always validates.

## Blocked on the user

- **Testiny connector re-auth** — the MCP session expired mid-session
  ("Unknown MCP session id"); reconnecting is interactive. Once reconnected:
  re-pull projects 7, 8, 9, 10, 11, 12, 14, 17 into `data/testiny/p<id>.json`
  and run `npm run snapshot` for the first delta report.
- **Run the real churn audit** — needs (a) which product git repo(s) hold the
  code for the 8 teams (fill the TODO globs in `catalog-audit.draft.yaml`),
  and (b) a `TESTINY_API_KEY` for the REST client.
- **Verify REST wire fields** — `src/testiny/client.ts` adapters
  (`text_description`, `testcase_folder_id`, `modified_at`, …) were derived from
  the docs and never checked against a live REST response. Needs an API key;
  fix belongs in the `map*` adapters only.
- **Date-based staleness in the snapshot** — the connector returns no
  create/modify timestamps; the REST API's `modified_at` would replace the
  legacy-folder-name proxy with real staleness.

## Out of scope (declared)

- Snapshot outputs beyond HTML (user chose HTML-only).
- Reporting on Synthetic Monitoring, Team Encore, Reporting, Cross Team,
  Productivity (excluded in `snapshot.config.json`).
