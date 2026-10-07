# AGENTS.md: working on gh-workflow-stats

Instructions for coding agents and the people who use them. Read it before
changing anything.

## What this is

A GitHub Action and a static site that give a repository a dashboard of its
CI health, test history and (later) DORA metrics, with no server: data is
collected by an Action, stored as JSON in the repository, and published to
GitHub Pages or Cloudflare Pages.

| Path | What |
|---|---|
| `packages/core/` | The data contract (JSON schema types) and statistics, shared |
| `packages/collector/` | The collector Action (TypeScript) |
| `packages/collector/dist/` | The bundled Action, committed, as GitHub runs it from the repo |
| `packages/site/` | The static dashboard: Preact, Vite and ECharts |
| `action.yml` | The Action's contract: inputs and outputs |
| `scripts/ci.sh` | Everything CI runs, in CI's order |
| `.github/workflows/` | CI (a thin wrapper over `scripts/ci.sh`) and this repo's own dashboard |
| `checks/` | Repo checks CI runs (secrets, comment density, raw HTML) |
| `.githooks/` | Pre-commit and pre-push secret scans |

A test-report Action, `packages/report`, arrives with test history. Don't
create a package ahead of the code that needs it.

## Getting started

```bash
mise install                               # Node and the check tools, from mise.toml
git config core.hooksPath .githooks        # secret scan before commit and push
npm ci
npm test
scripts/ci.sh                              # everything CI runs, in CI's order
```

- **Tool versions live in `mise.toml`.** CI installs the same. Don't install a
  different version by hand
- **npm**, with a committed `package-lock.json`. No other package manager

## How we work

- **Boring and obvious beats clever.** A contributor who knows TypeScript
  should be able to change a file without learning a local framework. No
  custom DSLs, no code generation, no clever abstractions
- **A new dependency is a decision.** Say why in the pull request. The Node
  standard library, `@actions/*` and what is already used come first. Every
  dependency of the Action ships inside `dist/` to every user
- **Vertical slices**: collect → store → show, for one thing a team wants to
  see. Each is useful on its own. A change that only adds a layer is not a
  slice
- **Ask before building when something is unclear.** A question answered
  mid-implementation is a guess
- **Everything in this repo is public**, including comments and commit
  messages

### Comments: less comment than code

- A file comment says what the file does, in 1–3 lines. A function comment
  is a TSDoc line saying what it does, accepts and returns
- Anything else is a one-liner, and only for a non-obvious *why* or a warning
- No decision narratives or incident stories in code; reasoning goes in
  `docs/`
- `checks/comment-density.sh` measures it (about 20% inline at most, no block
  over 8 lines)

### Tests: TDD, on everything

- Write the failing test, **watch it fail**, make it pass, refactor. A test
  that passes before the code exists tests nothing
- **Test the failure paths**: the API error, the rate limit, the missing
  artifact, the malformed JUnit file, the empty repository
- **Control what you depend on**: inject the clock, config and the GitHub
  client. No `Date.now()` or `new Date()` below the wiring layer. Tests never
  call the real GitHub API
- **Test what it does, not how it looks.** No render or DOM tests of site
  components. Keep a component thin and put its decisions (what to show, in
  what order, which fallback) in a `lib/` function with its own test
- **A test checks what it is about**, not a whole object or every field
- **Test data is invented.** No real usernames, emails, or another project's
  run data. Use `octo-user-1` style names

### Safety rules that are not negotiable

- **No credential in git, ever.** Not in code, docs, tests or commit
  messages. The git hooks and CI scan for them
- **Never invent a value you did not look up**: an action's commit SHA, a
  version, an id. Resolve it with a command
- **Everything from GitHub is untrusted input.** Branch names, commit
  messages, test names, job names and PR titles are written by anyone who can
  open a pull request. The site renders them as text, never as HTML: no
  `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `dangerouslySetInnerHTML`
  with data. They never reach a shell or a workflow expression unquoted
- **Least privilege.** The Action asks for the narrowest token permissions
  that work and documents each one. It never needs a token that can push to
  the user's default branch, only to its data branch
- **Fail closed.** Missing config or a token without the permissions it needs
  stops the run with a clear message. It never publishes partial data as if
  it were complete
- **Verify a control by using it.** A permission, a CSP, a skipped fork:
  prove it with a run or a test that would fail without it

## The Action

- `action.yml` is the contract. A change to its inputs or outputs is a
  change for every user: document it in `README.md` in the same PR
- `packages/collector/dist/` is built by `npm run package` and committed. CI fails when it
  differs from a fresh build
- Collection is **incremental**: it reads what it stored last time and
  fetches only newer runs. GitHub keeps artifacts and logs for 90 days by
  default, so data not collected in time is lost
- Respect rate limits: page through results, and stop and resume rather than
  retrying in a loop

## The site

- **Static.** It fetches JSON files next to it and nothing else: no backend,
  no third-party requests, no analytics
- Works from any base path, so the same build serves GitHub Pages
  (`/<repo>/`) and Cloudflare Pages (`/`)
- **Plain CSS** with custom-property tokens. No inline `style="…"`
- CSP without `'unsafe-inline'` for scripts
- Accessibility: semantic HTML, keyboard reachable, table headers and
  captions, and a table or text alternative for every chart

## Workflows

- Actions pinned by commit SHA, with the tag in a comment
- `permissions:` set per job, least privilege. No `pull_request_target`
- Hosted runners only. This repo is public, and a self-hosted runner would run
  fork PRs' code
- `actionlint` and `zizmor` run in CI

## Git and pull requests

- Branch from the latest `main`; never commit to `main` directly
- **Commit messages**: one line, imperative, capitalised, no full stop, about
  50 characters (72 at most). Describe the change in plain words:
  `Add incremental sync of workflow runs`. No AI or tool attribution trailers
- **Pull requests have two sections only**: **What it does** and **How to
  test it** (commands and URLs). Merging needs a maintainer
- **CI runs `scripts/ci.sh`.** If it passes locally it should pass in CI.
  Green is not the whole story: say what the change was *not* tested against
