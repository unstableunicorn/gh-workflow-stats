#!/usr/bin/env bash
# Everything CI runs, in CI's order. Run it locally before pushing.
# Ends by listing what it did not cover.
set -euo pipefail

cd "$(dirname "$0")/.."
not_covered=()
step() { printf '\n== %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

step 'TypeScript: typecheck, lint, format, tests'
npm run typecheck
npm run lint
npm run format-check
npm test

step 'Action bundle matches the source'
npm run package
if ! git diff --quiet -- packages/collector/dist report/dist || [ -n "$(git ls-files --others --exclude-standard -- packages/collector/dist report/dist)" ]; then
  echo "An Action bundle differs from a fresh build. Run npm run package and commit it." >&2
  git status --short -- packages/collector/dist report/dist >&2
  exit 1
fi
echo '  dist is up to date'

step 'Site: build and smoke test under a sub-path'
npm run build:site
if [ -n "${CI:-}" ] || node -e "import('playwright').then(p => p.chromium.launch()).then(b => b.close())" 2>/dev/null; then
  npm run smoke -w packages/site
else
  echo '  skipped: Chromium cannot start here (npx playwright install --with-deps chromium)'
  not_covered+=('site smoke test (Chromium unavailable locally)')
fi

step 'Repo checks'
bash checks/comment-density.sh
bash checks/no-raw-html.sh
bash checks/secret-scan.sh --all
if have gitleaks; then
  gitleaks git --redact --no-banner .
else
  echo '  gitleaks not installed: skipped'
  not_covered+=('gitleaks history scan (not installed)')
fi

step 'Workflows'
actionlint .github/workflows/*.yml
zizmor --quiet .github/workflows

step 'Shell'
shellcheck scripts/*.sh checks/*.sh .githooks/*

printf '\n== Not covered by this run\n'
for item in "${not_covered[@]}"; do echo "  - $item"; done
echo '  - the Action was not run against the GitHub API (only unit tests with fakes)'
echo '  - Pages deploy not exercised'
