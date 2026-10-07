#!/usr/bin/env bash
# Copy the published data from a data branch checkout into the built site.
# Usage: scripts/stage-site-data.sh <data-branch-dir> <site-dist-dir>
set -euo pipefail

src=${1:?data branch directory}
dest=${2:?site dist directory}
[ -f "$src/summary.json" ] || { echo "No summary.json in $src" >&2; exit 1; }

mkdir -p "$dest/data"
cp "$src/summary.json" "$dest/data/"
for dir in runs tests; do
  if [ -d "$src/$dir" ]; then cp -r "$src/$dir" "$dest/data/"; fi
done
echo "  staged: $(cd "$dest/data" && find . -name '*.json' | wc -l) data file(s)"
