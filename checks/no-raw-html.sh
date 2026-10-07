#!/usr/bin/env bash
# Fail when site source renders a string as HTML or carries an inline style.
# Branch, commit and test names come from anyone who can open a PR, so an HTML
# sink is an injection path, and the CSP allows no inline styles.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

if [ ! -d packages/site ]; then
  echo "  no-raw-html: skipped, packages/site does not exist yet"
  exit 0
fi

sinks='dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write'
inline_style='[[:space:]]style=("|\{)'

mapfile -t files < <(git ls-files -co --exclude-standard -- 'packages/site/src/**' |
  grep -E '\.(html|ts|tsx|js|jsx)$' | grep -vE '\.test\.tsx?$')

if [ ${#files[@]} -eq 0 ]; then
  echo "no-raw-html: packages/site exists but has no source to check" >&2
  exit 1
fi

found=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  if hits=$(grep -nE -e "$sinks" -e "$inline_style" "$f"); then
    printf '%s\n' "$hits" | sed "s|^|  $f:|" >&2
    found=$((found + 1))
  fi
done

if [ "$found" -gt 0 ]; then
  echo "no-raw-html: $found file(s) render raw HTML or use an inline style." >&2
  echo "  Set textContent, and add a token or a class instead of style=." >&2
  exit 1
fi
echo "  no-raw-html: ${#files[@]} file(s), no HTML sinks or inline styles"
