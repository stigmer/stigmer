#!/usr/bin/env bash
#
# bootstrap.sh — installs agent-specific MCP server packages at sandbox startup.
#
# Called by the runner-start-command before the agent-runner process starts.
# Reads two comma-separated env vars set by stigmer-service:
#   STIGMER_BOOTSTRAP_NPM_PACKAGES  — npm packages (installed via npm install -g)
#   STIGMER_BOOTSTRAP_PIP_PACKAGES  — pip packages (installed via uv tool install)
#
# Failures on individual packages are logged but do not abort the script.
# If both env vars are empty, exits immediately (no-op).

set -euo pipefail

NPM_PACKAGES="${STIGMER_BOOTSTRAP_NPM_PACKAGES:-}"
PIP_PACKAGES="${STIGMER_BOOTSTRAP_PIP_PACKAGES:-}"

if [[ -z "$NPM_PACKAGES" && -z "$PIP_PACKAGES" ]]; then
    exit 0
fi

START_TIME=$(date +%s)
echo "[bootstrap] Installing agent-specific MCP server packages …"

installed=0
failed=0

if [[ -n "$NPM_PACKAGES" ]]; then
    IFS=',' read -ra npm_pkgs <<< "$NPM_PACKAGES"
    for pkg in "${npm_pkgs[@]}"; do
        pkg="$(echo "$pkg" | xargs)"
        [[ -z "$pkg" ]] && continue
        if npm install -g "$pkg" --loglevel=error 2>&1; then
            installed=$((installed + 1))
        else
            echo "[bootstrap] WARN: failed to install npm package: $pkg"
            failed=$((failed + 1))
        fi
    done
    npm cache clean --force 2>/dev/null || true
fi

if [[ -n "$PIP_PACKAGES" ]]; then
    IFS=',' read -ra pip_pkgs <<< "$PIP_PACKAGES"
    for pkg in "${pip_pkgs[@]}"; do
        pkg="$(echo "$pkg" | xargs)"
        [[ -z "$pkg" ]] && continue
        if uv tool install "$pkg" 2>&1; then
            installed=$((installed + 1))
        else
            echo "[bootstrap] WARN: failed to install pip package: $pkg"
            failed=$((failed + 1))
        fi
    done
    uv cache clean 2>/dev/null || true
fi

ELAPSED=$(( $(date +%s) - START_TIME ))
echo "[bootstrap] Done: ${installed} installed, ${failed} failed (${ELAPSED}s)"
exit 0
