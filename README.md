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

And, with the report step in your test jobs, per test suite:

- flaky tests: tests that both passed and failed at the same commit
- the most failing and the slowest tests, and each test's history

DORA metrics are planned.

**See it running:** this repository's own dashboard is at
<https://gh-workflow-stats.unstableunicorn.dev/>.

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
  workflow_run: # after every CI run, so new runs and test reports arrive promptly
    workflows: [CI]
    types: [completed]
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

`workflow_run` always runs your default branch's copy of the workflow, even
when a pull request from a fork triggered it, and the collector never runs or
trusts pull request code: it treats report artifacts as untrusted data. A
schedule works too, but GitHub runs schedules late or skips them under load.

**Protect your default branch.** `contents: write` on `GITHUB_TOKEN` can
push to any branch. The collector only writes its data branch, but a ruleset
that requires pull requests on your default branch makes that a guarantee.

**When the default branch cannot be protected** (a private repository on
GitHub Free has no branch protection or rulesets), keep write access out of
the repository altogether: write the data to a separate private repository,
with a GitHub App token that can write only there. The collector job then
needs only `actions: read`:

1. Create a private repository for the data, for example `octo-org/octo-stats`
2. Create a GitHub App with one repository permission, **Contents: Read and
   write**, and install it on the data repository only
3. Store the App's client ID and private key as secrets of the repository
   being measured
4. Mint a token for the data repository in the collector job:

```yaml
    permissions:
      actions: read
    steps:
      - id: data-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          client-id: ${{ secrets.STATS_APP_CLIENT_ID }}
          private-key: ${{ secrets.STATS_APP_PRIVATE_KEY }}
          repositories: octo-stats
          permission-contents: write
      - uses: unstableunicorn/gh-workflow-stats@<commit-sha>
        with:
          data-repository: octo-org/octo-stats
          data-token: ${{ steps.data-token.outputs.token }}
```

The data branch must still not be the data repository's default branch.

**GitHub Pages sites are public**, except on GitHub Enterprise Cloud. For a
private repository, publish the site to Cloudflare Pages with Cloudflare
Access in front of it _before_ the first deploy.

### Inputs

| Input           | Default                  | What                                                              |
| --------------- | ------------------------ | ----------------------------------------------------------------- |
| `token`         | `${{ github.token }}`    | Needs `actions: read`; also `contents: write` without `data-token` |
| `data-branch`   | `gh-workflow-stats-data` | Where the JSON goes. Must not be the default branch               |
| `data-repository` | this repository        | `owner/name` to write the data to                                  |
| `data-token`    | `token`                  | A token that can write `data-repository`                          |
| `backfill-days` | `90`                     | History to collect on the first run                               |
| `max-requests`  | `300`                    | Approximate API requests per run; the next run continues          |
| `recent-days`   | `30`                     | The window for the headline numbers in `summary.json`             |

### Outputs

| Output           | What                                                         |
| ---------------- | ------------------------------------------------------------ |
| `runs-added`     | Runs added or updated                                        |
| `complete`       | `true` when the sync caught up, `false` if it stopped early  |
| `synced-through` | Data is complete for runs created before this time (ISO 8601) |

### Test results

Add the report step after each test command. It reads the test tool's
report, uploads a small normalized report as an artifact, and writes a job
summary. The collector picks the artifact up on its next run.

```yaml
      - run: pytest --junitxml=reports/pytest.xml
      - if: ${{ !cancelled() }}
        uses: unstableunicorn/gh-workflow-stats/report@<commit-sha>
        with:
          path: reports/pytest.xml
          suite: engine
```

It reads **JUnit XML**, which most test tools write, and **`go test -json`**
output. For example:

| Tool        | Command                                                           |
| ----------- | ----------------------------------------------------------------- |
| pytest      | `pytest --junitxml=reports/pytest.xml`                            |
| Vitest      | `vitest run --reporter=default --reporter=junit --outputFile.junit=reports/vitest.xml` |
| Go          | `go test -json ./... > reports/go.json`                           |
| gotestsum   | `gotestsum --junitfile reports/go.xml`                            |

| Input            | Default | What                                                          |
| ---------------- | ------- | ------------------------------------------------------------- |
| `path`           |         | Report files, one glob per line                               |
| `suite`          |         | A label for these results, unique in the workflow run         |
| `format`         | `auto`  | `auto`, `junit` or `go-json`                                  |
| `retention-days` | `14`    | Days to keep the artifact; the collector needs it until it runs |

Use `if: ${{ !cancelled() }}` so failing tests are still reported. With
`go test -json`, a package that fails to build is recorded as a failed test
named `(package)`, so the failure is not lost.

Test names come from your repository and its pull requests, and are treated
as untrusted: the site shows them as text. Failure messages and output are not
stored, as they can contain secrets printed by a test.

### Data layout

The data branch holds `summary.json` (the index the site loads first),
`state.json` (where to resume), `runs/YYYY-MM.json` (one month of runs
with their jobs) and `tests/YYYY-MM.json` (one month of test results: failed
and skipped tests per run, and per test per day the executions, failures and
total and longest duration). Every file carries a `schemaVersion`; the collector and the
site refuse data from a version they do not read. The collector also refuses
an existing branch it did not create.

### Known limits

- A re-run more than a day after the original run was created is not picked
  up
- A run still queued or in progress two days after it was created is skipped
- Test durations are shown as a daily mean and maximum, not percentiles
- A flaky test is only found when both results come from runs at the same
  commit and suite: a re-run, or a push and a pull request run of one commit
- GitHub keeps run history for a limited time, and `GITHUB_TOKEN` gets about
  1,000 API requests an hour per repository. A collection that stops early
  resumes the next time the workflow runs

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
