# catalog-audit

A CLI that cross-references **Testiny** regression catalogs against actual **git
churn**, flagging coverage gaps, stale catalogs, and orphaned test cases — so
regression catalogs stay a living system instead of a one-time compliance
exercise.

It answers a question Testiny can't: **does the catalog match the code?**

## Quickstart

```bash
npm install -g catalog-audit          # or use via npx: npx catalog-audit ...

export TESTINY_API_KEY=...            # required
catalog-audit init                    # writes a starter catalog-audit.yaml
# edit catalog-audit.yaml: map your code paths to Testiny folders
catalog-audit areas                   # sanity check: config + credentials work
catalog-audit audit                   # run the full audit (Markdown to stdout)
```

Write report files instead of stdout:

```bash
catalog-audit audit --format both --out ./reports
# -> ./reports/audit-report.md and ./reports/audit-report.json
```

## Commands

| Command | Purpose |
|---|---|
| `catalog-audit init` | Detect the git repo, prompt for the Testiny project, write a starter `catalog-audit.yaml`. |
| `catalog-audit audit [flags]` | Run the full audit. Flags override config values. |
| `catalog-audit map [--ai] [--out <path>]` | Report path→catalog mapping health (unmapped churn, empty areas, overlaps). |
| `catalog-audit areas` | List configured areas with resolved Testiny folders and case counts. |

`audit` flags: `--config <path>`, `--area <name>`, `--window <days>`,
`--format md|json|both`, `--out <dir>`, `--ai`,
`--fail-on high|medium|low|never`.

Global flags: `--config`, `--verbose`, `--no-color` (also honors `NO_COLOR`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `TESTINY_API_KEY` | yes | Testiny REST API key |
| `TESTINY_BASE_URL` | no | Defaults to `https://app.testiny.io/api/v1` |
| `ANTHROPIC_API_KEY` | only for `--ai` | Claude API for mapping suggestions / coverage judgment |
| `CATALOG_AUDIT_MODEL` | no | Overrides the default Claude model (`claude-sonnet-4-6`) |

Missing `TESTINY_API_KEY` exits `2` with an actionable message. `ANTHROPIC_API_KEY`
is only required when `--ai` is passed.

## Configuration

`catalog-audit.yaml` lives at the repo root (or pass `--config`). One file can
describe many teams/areas. See [`examples/catalog-audit.example.yaml`](examples/catalog-audit.example.yaml)
for a fully commented example. Path globs use `minimatch` semantics; invalid
config prints every violation with its YAML path and exits `2`.

Areas can share one Testiny project (top-level `testiny.project` + per-area
`folder`) or each target their own project (`areas[].testiny.project`) for
one-project-per-team Testiny layouts. Omitting an area's `folder` maps it to
the entire project.

## Finding types

| Type | Trigger | Severity |
|---|---|---|
| `missing-catalog` | Project/folder not found, or empty | high |
| `coverage-gap` | High churn + too few healthy cases | high |
| `stale-catalog` | ≥50% of cases stale (high if ≥80%) | medium/high |
| `stale-case` | An individual stale case | low |
| `orphaned-case` | References a path/route no longer in the repo | medium |
| `unmapped-churn` | Changed path (>3 commits) maps to no area | medium |
| `overlapping-areas` | A path is claimed by multiple areas | warning |

## Churn model

For each area, over `churn.windowDays`, we compute (bulk commits weighted at
`0.25`):

- `commits`, `filesChanged`, `linesDelta`, `lastChangedAt`
- `churnScore = round(commits * 3 + filesChanged + linesDelta / 100)`

Scoring lives in one pure function (`src/churn/score.ts`). Churn is read from
`git log --numstat` only — no refs are checked out.

## Exit codes

`0` pass · `1` audit failed per `failOn` · `2` config/credential/runtime error.

## JSON report schema (CI/automation contract)

`audit-report.json` is versioned with `"schemaVersion": 1`. Any breaking change
bumps the version.

```jsonc
{
  "schemaVersion": 1,
  "runInfo": {
    "repo": "/abs/path",
    "branch": "main",
    "windowDays": 90,
    "generatedAt": "2026-07-01T00:00:00.000Z",
    "status": "PASS",           // or "FAIL"
    "aiEnabled": false
  },
  "areas": [
    {
      "name": "payments",
      "team": "Valkyrie",
      "churnScore": 120,
      "commits": 30,
      "filesChanged": 42,
      "linesDelta": 3100,
      "lastChangedAt": "2026-06-30T12:00:00.000Z",
      "folderFound": true,
      "totalCases": 8,
      "healthyCases": 3,
      "staleCases": 5,
      "minCases": 10,
      "findingsCount": 2,
      "worstSeverity": "high"    // or medium | low | warning | null
    }
  ],
  "findings": [
    {
      "type": "coverage-gap",
      "severity": "high",
      "area": "payments",
      "message": "...",
      "evidence": { "churnScore": 120, "healthyCases": 3, "minCases": 10 }
      // "ai": { "rating": 40, "suggestions": ["..."] }  // only with --ai
    }
  ]
}
```

## CI usage (GitHub Actions)

Fail the job when the audit exit code is non-zero (`1` = catalog health gate,
`2` = configuration/credential error):

```yaml
name: Regression catalog audit
on: [pull_request]
jobs:
  catalog-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # full history so churn can be computed
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx catalog-audit audit --format both --out ./reports
        env:
          TESTINY_API_KEY: ${{ secrets.TESTINY_API_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: catalog-audit-report
          path: reports/
```

A non-zero exit fails the step; `--fail-on` controls the severity gate.

## Development

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/
npm run audit:fixture   # full audit against bundled fixtures (no network)
```

See [`CLAUDE.md`](CLAUDE.md) for architecture invariants.
