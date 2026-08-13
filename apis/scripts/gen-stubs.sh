#!/usr/bin/env bash
#
# Resilient proto stub generation for a single language target.
#
# Two properties this script guarantees that plain `buf generate` does not:
#
#   1. Skip-when-unchanged. The committed stubs are the source of truth. We hash
#      every local .proto plus the buf config and the language's gen template,
#      and store it next to the stubs (`.stub-hash`). If the hash matches, we do
#      nothing — so a routine publish never reaches out to buf.build (or any
#      plugin) when the protos haven't changed. Set STUBS_FORCE=1 to always
#      regenerate (CI does this to keep its freshness guarantee).
#
#   2. Non-destructive. We generate into a temp dir and only swap the result into
#      place *after* generation succeeds. A buf.build outage (the remote plugins
#      run on their servers) can therefore never delete good committed stubs and
#      leave you with nothing — the previous failure mode that wiped the tree.
#
# Usage: scripts/gen-stubs.sh <go|java|python|ts>
# Exit codes: 0 = generated, 2 = skipped (up to date), 1 = failure.
#
# Run from the apis/ directory (the Makefile invokes it from there).

set -euo pipefail

lang="${1:?usage: gen-stubs.sh <go|java|python|ts>}"

case "$lang" in
  go)
    template=buf.gen.go.yaml
    outroot=stubs/go
    managed="ai"
    stamp=stubs/go/.stub-hash
    ;;
  java)
    template=buf.gen.java.yaml
    outroot=stubs/java/src/main/java
    managed="ai buf"
    stamp=stubs/java/.stub-hash
    ;;
  python)
    template=buf.gen.python.yaml
    outroot=stubs/python/stigmer
    managed="ai buf google"
    stamp=stubs/python/.stub-hash
    ;;
  ts)
    template=buf.gen.ts.yaml
    outroot=stubs/ts
    # "google" carries the google.rpc error-detail types and "grpc" the
    # grpc.health.v1 probe service, each generated from its dedicated
    # module input in buf.gen.ts.yaml.
    managed="ai buf google grpc"
    stamp=stubs/ts/.stub-hash
    ;;
  *)
    echo "gen-stubs: unknown language '$lang'" >&2
    exit 1
    ;;
esac

# Hash of everything that affects generated output: the proto sources, the buf
# workspace config, the pinned dependency lock, and this language's template
# (which carries the plugin versions). Generated stubs are excluded so the hash
# describes inputs only.
compute_hash() {
  {
    find . -name '*.proto' -not -path './stubs/*' | LC_ALL=C sort | xargs cat
    cat buf.yaml buf.lock "$template"
  } | shasum -a 256 | cut -d' ' -f1
}

hash="$(compute_hash)"

if [ "${STUBS_FORCE:-0}" != "1" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$hash" ]; then
  exit 2
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# `buf generate -o DIR` prepends DIR to each `out:` in the template, so output
# lands at "$tmp/$outroot/...". Generation happens entirely in the temp tree.
buf generate --template "$template" -o "$tmp"

# Go's managed go_package_prefix nests output under github.com/.../stubs/go;
# flatten it back the way the committed tree expects.
if [ "$lang" = "go" ] && [ -d "$tmp/stubs/go/github.com" ]; then
  mv "$tmp/stubs/go/github.com/stigmer/stigmer/apis/stubs/go/"* "$tmp/stubs/go/" 2>/dev/null || true
  rm -rf "$tmp/stubs/go/github.com"
fi

# Atomic-ish swap: replace each managed subtree only now that generation worked.
mkdir -p "$outroot"
for d in $managed; do
  if [ -d "$tmp/$outroot/$d" ]; then
    rm -rf "${outroot:?}/$d"
    mv "$tmp/$outroot/$d" "$outroot/$d"
  fi
done

echo "$hash" > "$stamp"
exit 0
