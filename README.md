# gh-workflow-stats

A CI health dashboard for a GitHub repository, with no server. A GitHub Action
collects your workflow runs into JSON on a branch of your repository, and a
static site, published to GitHub Pages or Cloudflare Pages, charts them.

It shows, per workflow:

- runs, success rate, and run duration (p50 and p95)
- queue time: how long jobs wait for a runner
- the slowest jobs
- zoomable, linked charts of duration and daily success rate, filterable by
  branch and period, with every point linking to its run on GitHub

Test history and DORA metrics are planned.

> **Status: early.** There is no release yet. Pin the Action to a commit SHA.

## How it works

```
schedule / push ──► collector Action ──► data branch (JSON) ──► site build ──► Pages
```

- The collector reads runs through the GitHub API and commits JSON to a data
  branch (default `gh-workflow-stats-data`). It never touches your default
  branch, and refuses to run if you point it there
- Collection is **incremental**. Each run fetches only runs created since the
  last one, plus the last day again to pick up re-runs. A first run backfills
  `backfill-days` of history
- It stays inside a request budget (`max-requests`) and stops cleanly on a
  rate limit. The next run resumes where it stopped. The site says how far
  back the data is complete
- The site is static. It fetches only the JSON next to it: no backend, no
  third-party requests, no analytics

## Usage

Add a workflow like this (see this repository's own
[`.github/workflows/dashboard.yml`](.github/workflows/dashboard.yml) for the
build and Pages deploy jobs):

```yaml
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:

jobs:
  collect:
    runs-on: ubuntu-24.04
    permissions:
      actions: read # list runs and jobs
      contents: write # commit to the data branch
    steps:
      - uses: unstableunicorn/gh-workflow-stats@<commit-sha>
```

**Protect your default branch.** `contents: write` on `GITHUB_TOKEN` can
push to any branch. The collector only writes its data branch, but a ruleset
that requires pull requests on your default branch makes that a guarantee.

**GitHub Pages sites are public**, except on GitHub Enterprise Cloud. For a
private repository, publish the site to Cloudflare Pages with Cloudflare
Access in front of it _before_ the first deploy.

### Inputs

| Input           | Default                  | What                                                              |
| --------------- | ------------------------ | ----------------------------------------------------------------- |
| `token`         | `${{ github.token }}`    | Needs `actions: read` and `contents: write`                       |
| `data-branch`   | `gh-workflow-stats-data` | Where the JSON goes. Must not be the default branch               |
| `backfill-days` | `90`                     | History to collect on the first run                               |
| `max-requests`  | `300`                    | Approximate API requests per run; the next run continues          |
| `recent-days`   | `30`                     | The window for the headline numbers in `summary.json`             |

### Outputs

| Output           | What                                                         |
| ---------------- | ------------------------------------------------------------ |
| `runs-added`     | Runs added or updated                                        |
| `complete`       | `true` when the sync caught up, `false` if it stopped early  |
| `synced-through` | Data is complete for runs created before this time (ISO 8601) |

### Data layout

The data branch holds `summary.json` (the index the site loads first),
`state.json` (where to resume) and `runs/YYYY-MM.json` (one month of runs
with their jobs). Every file carries a `schemaVersion`; the collector and the
site refuse data from a version they do not read. The collector also refuses
an existing branch it did not create.

### Known limits

- A re-run more than a day after the original run was created is not picked
  up
- A run still queued or in progress two days after it was created is skipped
- GitHub keeps run history for a limited time, and `GITHUB_TOKEN` gets about
  1,000 API requests an hour per repository. Run the collector at least daily

## Development

See [`AGENTS.md`](AGENTS.md) for how we work. In short:

```bash
mise install                         # Node and the check tools
git config core.hooksPath .githooks  # secret scan before commit and push
npm ci
npm test
scripts/ci.sh                        # everything CI runs
npm run dev -w packages/site         # the site, with data in packages/site/public/data
node packages/site/fixtures/make-fixtures.mjs packages/site/public/data  # invented data
```

## License

MIT
