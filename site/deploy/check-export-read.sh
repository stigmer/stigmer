#!/usr/bin/env bash
# Refuse a deploy before it happens unless wrangler accepts the whole export: a dry run that reads
# every entry and finds nothing to refuse.
#
# Two ways a deploy goes wrong without failing loudly enough. A deploy that uploads part of the export
# fails nothing: the missing pages answer 404. That is how another site's first deploy on this tool
# went, when its package manager's patched fs ignored readdir's `recursive` and wrangler saw only the
# top-level files; so wrangler's own count, from the dry run, must equal what is on disk. And a file
# Cloudflare will not store (one over the per-asset size limit) fails the dry run after the count is
# printed; so the dry run's own verdict must pass too, and its error is shown.
#
#   check-export-read.sh <wrangler args identifying the Worker, e.g. --env="">
#
# Run from site/deploy after `npm ci`, with the export in ../out.
set -euo pipefail

want="$(find ../out -mindepth 1 | wc -l | tr -d ' ')"
status=0
output="$(./node_modules/.bin/wrangler deploy --dry-run --config ../wrangler.jsonc "$@" 2>&1)" || status=$?
read_line="$(grep -E 'Read [0-9]+ files? from the assets directory' <<<"$output" || true)"
read_count="$(grep -oE 'Read [0-9]+' <<<"$read_line" | grep -oE '[0-9]+' || echo 0)"

if [[ "$status" -ne 0 ]]; then
  echo "$output" >&2
  echo "::error::wrangler refuses the export (dry run exit ${status}); refusing to deploy"
  exit 1
fi
if [[ "$read_count" != "$want" ]]; then
  echo "::error::wrangler reads ${read_count} of the export's ${want} entries; refusing to deploy a partial site"
  exit 1
fi
echo "wrangler reads and accepts all ${want} entries of the export"
