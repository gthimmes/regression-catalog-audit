# SPEC: `catalog-audit` — Regression Catalog Auditor

## One-liner

A CLI that cross-references Testiny regression catalogs against actual code activity, flagging coverage gaps, stale catalogs, and orphaned test cases — so regression catalogs stay a living system instead of a one-time compliance exercise.

## Problem

After retiring the dedicated QA team, every engineering team was required to define regression test catalogs in Testiny before resuming releases. The catalogs exist, but nothing keeps them honest over time:

- Code churns constantly; catalogs are updated manually and sporadically.
- There is no signal when a high-churn module has thin or stale regression coverage.
- Test cases can reference features or flows that were refactored away ("orphaned" cases).
- Release readiness reviews rely on a human (the Director of Engineering) manually eyeballing catalogs across 7+ teams.

This tool automates that audit and produces a per-team, per-area report that can gate releases or feed a readiness review.

## Goals

1. Pull regression catalogs from Testiny via its REST API (projects, folders/sections, test cases, metadata).
2. Analyze git history to compute code churn per configured "area" (path globs) over a configurable window.
3. Cross-reference the two via a mapping config (code paths ↔ Testiny catalog areas) and produce an audit report.
4. Flag four classes of findings:
   - **Coverage gaps** — high-churn areas with few or no mapped test cases.
   - **Stale catalogs** — mapped test cases not updated since significant changes landed in their area.
   - **Orphaned cases** — test cases whose referenced paths/features no longer exist in the repo.
   - **Unmapped churn** — changed paths that map to no catalog area at all (the mapping itself has a hole).
5. Output human-readable Markdown, machine-readable JSON, and a CI-friendly exit code.
6. (Optional, AI-assisted) Use the Claude API to suggest mappings and to judge whether test case titles/descriptions plausibly cover recent changes.

## Non-goals

- Does NOT execute tests or integrate with test runners. This audits *catalog health*, not test results.
- Does NOT write to Testiny in v1 (no auto-creating test cases). Read-only against Testiny.
- Does NOT replace Testiny's own reporting. It answers a question Testiny can't: "does the catalog match the code?"
- No web UI in v1. CLI + Markdown/JSON output only.

## Primary users

- Engineering leadership running release readiness reviews across teams.
- Engineering managers / tech leads keeping their team's catalog current.
- CI pipelines gating releases on catalog health.

---

## Architecture overview

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│ Testiny API │────▶│              │◀────│  git history  │
│ (test cases,│     │  Correlator  │     │  (churn per   │
│  folders)   │     │              │     │   path glob)  │
└─────────────┘     └──────┬───────┘     └───────────────┘
                           │
                    mapping config
                    (catalog-audit.yaml)
                           │
                           ▼
              ┌────────────────────────┐
              │  Findings + Scoring    │
              │  gaps / stale /        │
              │  orphaned / unmapped   │
              └───────────┬────────────┘
                          ▼
            Markdown report │ JSON │ exit code
            (optional) Claude-assisted analysis
```

## Tech stack

- **TypeScript (Node.js 20+)**, `strict: true`
- `commander` for CLI, `ora` for spinners, `chalk` for terminal output
- `simple-git` for repo/churn analysis
- `zod` for config validation
- `yaml` for config parsing
- Native `fetch` for Testiny + Anthropic APIs (no axios)
- `vitest` for tests
- Distribution: npm package with `bin` entry (`catalog-audit`), also usable via `npx`

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `TESTINY_API_KEY` | yes | Testiny REST API key |
| `TESTINY_BASE_URL` | no | Defaults to `https://app.testiny.io/api/v1` |
| `ANTHROPIC_API_KEY` | only for `--ai` features | Claude API for mapping suggestions / coverage judgment |

Missing required env vars must exit with a clear, actionable error message (exit code 2).

---

## Configuration: `catalog-audit.yaml`

Lives at repo root (or passed via `--config`). One file can describe multiple teams/areas — designed for a monorepo (Nx) but must also work pointed at a single-purpose repo.

```yaml
version: 1

repo:
  # Optional. Defaults to cwd. Must be a git repo.
  path: .
  # Branch to analyze. Defaults to the current branch.
  branch: main

churn:
  # Analysis window for "recent" changes.
  windowDays: 90
  # Commits touching more than this many files are treated as bulk
  # changes (formatting, codemods) and weighted at 0.25.
  bulkChangeFileThreshold: 50
  # Paths always ignored for churn purposes.
  ignore:
    - "**/*.md"
    - "**/package-lock.json"
    - "**/*.snap"

testiny:
  # Testiny project name or ID containing the regression catalogs.
  project: "Regression Catalogs"

areas:
  - name: payments
    team: Valkyrie
    paths:
      - "apps/payments/**"
      - "libs/payments/**"
    testiny:
      # Folder path within the Testiny project that holds this
      # area's regression cases. Matched case-insensitively.
      folder: "Payments"
    # Optional: minimum mapped, non-stale test cases for this area
    # to be considered healthy. Default: 1.
    minCases: 10

  - name: client-portal
    team: Rosetta
    paths:
      - "apps/portal/**"
      - "libs/portal/**"
    testiny:
      folder: "Client Portal"

thresholds:
  # An area is a COVERAGE GAP if churnScore >= gapChurnScore and
  # healthy (non-stale) mapped cases < minCases.
  gapChurnScore: 50
  # A test case is STALE if its area accumulated >= staleChurnScore
  # of churn since the case was last updated in Testiny.
  staleChurnScore: 100
  # Findings at or above these severities fail the audit (exit 1).
  failOn: high   # one of: high | medium | low | never
```

**Config rules**

- Validate with zod; on invalid config, print every violation with its YAML path and exit 2.
- Path globs use `minimatch` semantics.
- A path matching multiple areas is allowed but produces a `warning` in the report (overlapping ownership).

---

## Churn model

For each area, over `churn.windowDays`:

- `commits` — number of commits touching any matching path (bulk changes weighted 0.25).
- `filesChanged` — distinct files changed.
- `linesDelta` — additions + deletions (bulk-weighted).
- `lastChangedAt` — most recent commit date touching the area.
- `churnScore` — normalized composite: `round(commits * 3 + filesChanged * 1 + linesDelta / 100)`, bulk-weighted commits included at their weight. Keep the formula in one pure function (`src/churn/score.ts`) with unit tests; it will be tuned.

Churn must be computed from `git log --numstat` parsing via `simple-git`, never by checking out other refs. Read-only against the repo.

## Testiny integration

- Read-only. Consult the official Testiny REST API docs (https://www.testiny.io/docs/rest-api/) during implementation for exact endpoint shapes — do not guess field names; verify against the docs or a live `GET`.
- Required capabilities:
  1. Resolve project by name or ID.
  2. List folders/sections in the project (to resolve each area's `folder`).
  3. List test cases within a folder (recursively including subfolders), with: id, title, description (if available), created/updated timestamps, and any tags/custom fields returned by default.
- Paginate fully; never assume single-page responses.
- Cache raw Testiny responses per run in memory only (no disk cache in v1).
- All Testiny access goes through a single client module (`src/testiny/client.ts`) with typed responses and one retry (with backoff) on 429/5xx.
- If a configured folder cannot be found, that is a `high` finding of type `missing-catalog` for the area — not a crash.

## Finding types and severity

| Type | Trigger | Default severity |
|---|---|---|
| `missing-catalog` | Area's Testiny folder not found or contains zero cases | high |
| `coverage-gap` | `churnScore >= gapChurnScore` and healthy cases `< minCases` | high |
| `stale-catalog` | ≥ 50% of an area's cases are stale per `staleChurnScore` | medium (high if ≥ 80%) |
| `stale-case` | Individual case stale (listed under its area, capped at 20 per area in Markdown output) | low |
| `orphaned-case` | Case title/description references a file path or route that no longer exists in the repo (regex-extract path-like and URL-route-like tokens from case text; check existence) | medium |
| `unmapped-churn` | A changed path (above a noise floor of 3 commits) matches no area | medium |
| `overlapping-areas` | A path glob matches multiple areas | warning (never fails audit) |

Severity ordering: `high > medium > low > warning`. `thresholds.failOn` controls the exit-code gate.

## CLI commands

```
catalog-audit init
  Interactive: detects git repo, prompts for Testiny project, writes a
  starter catalog-audit.yaml with commented examples.

catalog-audit audit [--config <path>] [--area <name>] [--window <days>]
                    [--format md|json|both] [--out <dir>] [--ai]
                    [--fail-on high|medium|low|never]
  The main command. Runs the full audit. Default format: md to stdout.
  --out writes report file(s) to a directory (audit-report.md / .json).
  Flags override config values.

catalog-audit map [--ai] [--out <path>]
  Reports the current path→catalog mapping health: unmapped high-churn
  paths, empty areas, overlaps. With --ai, calls Claude to propose YAML
  `areas` entries for unmapped paths (printed as a suggested diff,
  never auto-applied).

catalog-audit areas
  Lists configured areas with their resolved Testiny folders and case
  counts. Fast sanity check that config + credentials work.
```

Global flags: `--config`, `--verbose`, `--no-color`. All commands honor `NO_COLOR`.

## AI features (behind `--ai`, optional at runtime)

Both features use the Anthropic API (`claude-sonnet-4-6` default, overridable via `CATALOG_AUDIT_MODEL`). The tool must be fully functional without `--ai`.

1. **Mapping suggestions** (`map --ai`): given unmapped high-churn paths plus the list of Testiny folders, ask Claude to propose `areas` YAML entries. Prompt contract: respond with YAML only inside a fenced block; parse and re-validate with zod before showing.
2. **Coverage judgment** (`audit --ai`): for each `coverage-gap` area, send the last N commit subjects (default 30) for the area plus the mapped test case titles; ask Claude to (a) rate plausible coverage 0–100 and (b) list up to 5 suggested regression case titles that would close the gap. Include the rating and suggestions in the report under the finding. This is advisory only — it never changes severities or exit codes.

Keep every Claude prompt in `src/ai/prompts.ts` as exported template functions with unit tests asserting key content is interpolated. One retry on malformed output with a corrective message; on second failure, degrade gracefully (report includes "AI analysis unavailable").

## Report formats

**Markdown** (`audit-report.md`): summary header (repo, branch, window, run date, overall status PASS/FAIL), a per-area table (area, team, churn score, cases, healthy cases, findings count, worst severity), then a findings section grouped by area and ordered by severity. Suitable for pasting into Slack/Notion — no HTML.

**JSON** (`audit-report.json`): stable schema, versioned with `"schemaVersion": 1`. Top-level: `runInfo`, `areas[]` (with churn metrics and case stats), `findings[]` (type, severity, area, message, evidence). This is the CI/automation contract — document it in the README.

**Exit codes**: `0` pass, `1` audit failed per `failOn`, `2` config/credential/runtime error.

---

## File structure

```
catalog-audit/
├── SPEC.md
├── README.md
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── examples/
│   └── catalog-audit.example.yaml
├── src/
│   ├── cli.ts               # commander wiring only
│   ├── config/
│   │   ├── schema.ts        # zod schema + types
│   │   └── load.ts
│   ├── churn/
│   │   ├── gitlog.ts        # numstat parsing
│   │   └── score.ts         # pure scoring functions
│   ├── testiny/
│   │   ├── client.ts        # typed API client, retry, pagination
│   │   └── resolve.ts       # project/folder/case resolution
│   ├── audit/
│   │   ├── correlate.ts     # areas × churn × cases
│   │   ├── findings.ts      # finding generation + severity
│   │   └── orphans.ts       # path/route token extraction + existence check
│   ├── ai/
│   │   ├── client.ts
│   │   └── prompts.ts
│   ├── report/
│   │   ├── markdown.ts
│   │   └── json.ts
│   └── commands/
│       ├── init.ts
│       ├── audit.ts
│       ├── map.ts
│       └── areas.ts
└── test/
    └── (mirrors src/; fixtures for git log output and Testiny responses)
```

## CLAUDE.md (project-level, for ongoing development)

Include a `CLAUDE.md` at repo root covering: the finding-type table (source of truth), the rule that Testiny access is read-only and centralized in `client.ts`, the rule that churn scoring lives only in `score.ts`, the JSON schema versioning policy (any breaking change bumps `schemaVersion`), and the command to run tests (`npm test`) and a full local audit against fixtures (`npm run audit:fixture`).

## Build order

1. `package.json`, `tsconfig.json`, vitest setup, commander skeleton with all four commands stubbed.
2. Config: zod schema, loader, `examples/catalog-audit.example.yaml`, validation errors.
3. Churn: `gitlog.ts` + `score.ts` with fixture-based tests (raw `--numstat` output fixtures).
4. Testiny client + resolution, with recorded-response fixtures (verify real API shapes against the docs first, then freeze fixtures).
5. Correlation + findings + orphan detection.
6. Reports (markdown, JSON) + exit-code gating; wire up `audit` and `areas` end to end.
7. `init` and `map` (non-AI).
8. AI features (`--ai` on `audit` and `map`).
9. README with quickstart, config reference, JSON schema doc, CI example (GitHub Actions step failing on exit 1).

## Acceptance criteria

- [ ] `catalog-audit audit` against a fixture repo + fixture Testiny responses produces deterministic Markdown and JSON matching snapshots
- [ ] Each of the 7 finding types has at least one unit test producing it and one asserting it is NOT produced just below its threshold
- [ ] `--fail-on` correctly gates exit codes for all four levels
- [ ] Missing `TESTINY_API_KEY` exits 2 with an actionable message; missing `ANTHROPIC_API_KEY` only errors when `--ai` is passed
- [ ] Testiny pagination handled (fixture with 3 pages)
- [ ] Bulk-change weighting verified by test (large codemod commit barely moves churnScore)
- [ ] `map --ai` output is re-validated with zod before display; malformed AI output degrades gracefully
- [ ] TypeScript compiles with zero errors under `strict: true`; `npm test` green
- [ ] README documents the JSON schema and a CI usage example
