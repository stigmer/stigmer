#!/usr/bin/env bash
# Whether a pull request's review site still serves a build: the one test both the close and the
# weekly sweep use, read from the site itself, so it needs no key and no list of which paths make a
# review site.
#
#   preview-is-open.sh <pull request number>
#
# Exits 0 when the version aliased review-<n> answers 200 without the closed marker close-preview.sh
# writes; 1 when it answers anything else (never uploaded, already closed, or unreachable). Reads
# PREVIEW_WORKER and WORKERS_SUBDOMAIN, which name the alias's own address.
set -euo pipefail

number="${1:?usage: preview-is-open.sh <pull request number>}"
[[ "$number" =~ ^[1-9][0-9]*$ ]] || { echo "not a pull request number: $number" >&2; exit 2; }
: "${PREVIEW_WORKER:?set PREVIEW_WORKER}" "${WORKERS_SUBDOMAIN:?set WORKERS_SUBDOMAIN}"

headers="$(curl -s -o /dev/null -D - --max-time 20 "https://review-${number}-${PREVIEW_WORKER}.${WORKERS_SUBDOMAIN}.workers.dev/" || true)"
grep -qi '^HTTP/[0-9.]* 200' <<<"$headers" && ! grep -qi '^x-stigmer-preview: closed' <<<"$headers"
