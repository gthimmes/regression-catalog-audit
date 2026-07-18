# CLAUDE.md — catalog-audit

Project-level guidance for ongoing development. Read this before changing audit
logic, the Testiny client, or the report schema.

## What this is

A CLI that cross-references Testiny regression catalogs against git churn and
produces a per-team/per-area audit report (Markdown + JSON + CI exit code). See
`SPEC.md` for the full specification.

## Finding types (source of truth)

| Type | Trigger | Default severity |
|---|---|---|
| `missing-catalog` | Area's Testiny project or folder not found, or contains zero cases | high |
| `coverage-gap` | `churnScore >= gapChurnScore` and healthy cases `< minCases` | high |
| `stale-catalog` | ≥ 50% of an area's cases are stale per `staleChurnScore` | medium (high if ≥ 80%) |
| `stale-case` | Individual case stale (capped at 20 per area in Markdown) | low |
| `orphaned-case` | Case title/description references a path/route no longer in the repo | medium |
| `unmapped-churn` | A changed path (> 3 commits) matches no area | medium |
| `overlapping-areas` | A path glob matches multiple areas | warning (never fails) |

Severity ordering: `high > medium > low > warning`. `thresholds.failOn` gates the
exit code (warnings never fail).

## Invariants (do not violate)

- **Testiny access is read-only and centralized** in `src/testiny/client.ts`.
  All wire-field mapping lives there; the rest of the code depends only on the
  normalized `TestinyProject` / `TestinyFolder` / `TestinyCase` shapes. If real
  API field names differ from the docs, adjust the `map*` adapters in that file
  and nowhere else.
- **Churn scoring lives only in `src/churn/score.ts`** (`computeChurnScore`). It
  is pure and unit-tested; tune it there.
- **Never check out other git refs.** Churn is computed from `git log --numstat`
  via `simple-git` only (`src/churn/gitlog.ts`).
- **JSON schema versioning:** any breaking change to the JSON report shape
  (`src/report/json.ts`) MUST bump `JSON_SCHEMA_VERSION`.
- **AI is advisory only.** `--ai` output never changes severities or exit codes,
  and the tool must be fully functional without it. All prompts live in
  `src/ai/prompts.ts`.

## Exit codes

`0` pass · `1` audit failed per `failOn` · `2` config/credential/runtime error.

## Environment variables

- `TESTINY_API_KEY` (required for `audit`, `areas`, `map`)
- `TESTINY_BASE_URL` (optional; defaults to `https://app.testiny.io/api/v1`)
- `ANTHROPIC_API_KEY` (required only when `--ai` is passed)
- `CATALOG_AUDIT_MODEL` (optional; overrides the default Claude model)

## Commands

- Run tests: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Full local audit against fixtures: `npm run audit:fixture`
