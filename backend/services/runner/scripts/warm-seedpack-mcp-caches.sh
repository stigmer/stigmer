#!/usr/bin/env bash
# Warm the npx / uvx / go caches for every seedpack stdio MCP server
# (warm-agent-surfaces Phase 1).
#
# WHY: MCP server packages are installed on demand during execution setup —
# each stdio server is a fresh `npx`/`uvx` subprocess whose first run pays a
# full registry download + install. The marketplace (seedpack) is a curated,
# bounded catalog, so those caches can be populated when the image is BUILT,
# removing the install cost from every execution on every surface with zero
# runtime machinery. Custom (non-seedpack) servers still install on demand.
#
# HOW (deliberately without ever executing an MCP server — a stdio server
# started at build time would hang waiting for a client):
#   npx: `npx -y -p <pkg> node -e ""` installs <pkg> into npm's npx cache
#        (~/.npm/_npx) and the tarball/metadata cache (~/.npm/_cacache), then
#        runs a no-op node instead of the package binary. Even if a future npm
#        changes the _npx cache keying, the _cacache warm alone removes the
#        network download — the dominant cost.
#   uvx: `uvx --from <pkg> python -c ""` resolves the package into uv's wheel
#        and environment caches (~/.cache/uv) and runs the venv's python no-op.
#   go:  `go install <module>@latest` into a throwaway GOBIN warms the module
#        and build caches that `go run` reuses (only the final link remains).
#
# Version drift is self-correcting: specs pinned to a tag (e.g. @latest) are
# re-resolved at runtime; a version published after the image build simply
# cache-misses back to today's on-demand install until the next image release.
#
# FAILURE POSTURE: best-effort per package. A package that fails to warm
# (registry hiccup, broken install script) logs and is skipped — the image
# build must never fail because one marketplace entry is unhealthy; that
# server just keeps its on-demand install cost.
#
# Usage: warm-seedpack-mcp-caches.sh <dir-with-mcp-server-yamls>
set -u

CATALOG_DIR="${1:?usage: warm-seedpack-mcp-caches.sh <dir-with-mcp-server-yamls>}"

warmed=0
skipped=0
failed=0

# First positional (non-flag, non-placeholder) argument = the package spec.
# Flags (-y, --access-mode=…) and env placeholders (${VAR}) are never specs.
first_package_spec() {
  for arg in "$@"; do
    case "$arg" in
      -*|\$\{*\}*) continue ;;
      *) printf '%s' "$arg"; return 0 ;;
    esac
  done
  return 1
}

for yaml in "$CATALOG_DIR"/*.yaml; do
  [ -e "$yaml" ] || continue
  command="$(yq -r '.spec.stdio.command // ""' "$yaml")"
  [ -n "$command" ] || { skipped=$((skipped + 1)); continue; }

  # shellcheck disable=SC2207 # args are single tokens by the seedpack schema
  args=($(yq -r '.spec.stdio.args // [] | .[]' "$yaml"))

  name="$(basename "$yaml" .yaml)"
  case "$command" in
    npx)
      if pkg="$(first_package_spec "${args[@]}")"; then
        echo "[warm-mcp] npx: $name -> $pkg"
        if npx -y -p "$pkg" node -e "" >/dev/null 2>&1; then
          warmed=$((warmed + 1))
        else
          echo "[warm-mcp] WARN: npx warm failed for $pkg (kept on-demand)" >&2
          failed=$((failed + 1))
        fi
      else
        skipped=$((skipped + 1))
      fi
      ;;
    uvx)
      if pkg="$(first_package_spec "${args[@]}")"; then
        echo "[warm-mcp] uvx: $name -> $pkg"
        if uvx --from "$pkg" python -c "" >/dev/null 2>&1; then
          warmed=$((warmed + 1))
        else
          echo "[warm-mcp] WARN: uvx warm failed for $pkg (kept on-demand)" >&2
          failed=$((failed + 1))
        fi
      else
        skipped=$((skipped + 1))
      fi
      ;;
    go)
      # Seedpack go servers use `go run <module>@<tag> …`; the module path is
      # the first arg after the `run` subcommand.
      module=""
      for arg in "${args[@]}"; do
        case "$arg" in
          run) continue ;;
          -*) continue ;;
          *) module="$arg"; break ;;
        esac
      done
      if [ -n "$module" ]; then
        echo "[warm-mcp] go: $name -> $module"
        if GOBIN="$(mktemp -d)" go install "$module" >/dev/null 2>&1; then
          warmed=$((warmed + 1))
        else
          echo "[warm-mcp] WARN: go warm failed for $module (kept on-demand)" >&2
          failed=$((failed + 1))
        fi
      else
        skipped=$((skipped + 1))
      fi
      ;;
    *)
      echo "[warm-mcp] skip: $name uses unsupported command '$command'"
      skipped=$((skipped + 1))
      ;;
  esac
done

echo "[warm-mcp] done: warmed=$warmed, failed=$failed, skipped=$skipped"
# Best-effort by design — never fail the image build.
exit 0
