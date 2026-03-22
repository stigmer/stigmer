#!/usr/bin/env bash
#
# Performance Budget Lint for Stigmer Sales Website
#
# Validates build output against performance-budget.json:
# - JS bundle size (gzipped) vs max_js_kb
# - CSS bundle size (gzipped) vs max_css_kb
# - Individual image sizes vs max_individual_kb
# - Prohibited image formats (.gif, .bmp)
# - Font family count vs max_families
#
# Prerequisite: next build must have been run (checks for .next/ or out/).
#
# Exit code: 0 if all checks pass, 1 if any violation found.
#
# Usage: bash scripts/lint-performance.sh

set -euo pipefail

SITE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUDGET_FILE="$SITE_ROOT/standards/performance-budget.json"
PUBLIC_DIR="$SITE_ROOT/public"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

fail_count=0

pass() {
  printf "  %-45s ... \033[32mPASS\033[0m\n" "$1"
}

fail() {
  printf "  %-45s ... \033[31mFAIL\033[0m\n" "$1"
  fail_count=$((fail_count + 1))
}

read_budget() {
  node -e "
    const b = require('$BUDGET_FILE');
    const key = '$1';
    const parts = key.split('.');
    let v = b;
    for (const p of parts) { v = v?.[p]; }
    if (v === undefined) { process.exit(1); }
    process.stdout.write(String(v));
  " 2>/dev/null
}

# Sum gzipped size of all files matching a pattern under a directory (in KB).
sum_gzipped_kb() {
  local dir="$1"
  local ext="$2"
  local total=0

  if [ ! -d "$dir" ]; then
    echo "0"
    return
  fi

  while IFS= read -r -d '' file; do
    local gz_bytes
    gz_bytes=$(gzip -c "$file" | wc -c | tr -d ' ')
    total=$((total + gz_bytes))
  done < <(find "$dir" -name "*.$ext" -type f -print0 2>/dev/null)

  echo $(( (total + 512) / 1024 ))
}

# File size in KB.
file_size_kb() {
  local bytes
  bytes=$(wc -c < "$1" | tr -d ' ')
  echo $(( (bytes + 512) / 1024 ))
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if [ ! -f "$BUDGET_FILE" ]; then
  echo "Error: performance-budget.json not found at $BUDGET_FILE"
  exit 1
fi

# Find build output directory.
BUILD_STATIC=""
if [ -d "$SITE_ROOT/out/_next/static" ]; then
  BUILD_STATIC="$SITE_ROOT/out/_next/static"
elif [ -d "$SITE_ROOT/.next/static" ]; then
  BUILD_STATIC="$SITE_ROOT/.next/static"
fi

echo ""
echo "Performance Budget Check"
echo "========================"
echo ""

# ---------------------------------------------------------------------------
# 1. Bundle sizes (only if build output exists)
# ---------------------------------------------------------------------------

MAX_JS_KB=$(read_budget "bundle.max_js_kb" || echo "150")
MAX_CSS_KB=$(read_budget "bundle.max_css_kb" || echo "50")

if [ -n "$BUILD_STATIC" ]; then
  JS_KB=$(sum_gzipped_kb "$BUILD_STATIC" "js")
  CSS_KB=$(sum_gzipped_kb "$BUILD_STATIC" "css")

  label_js="JS bundle: ${JS_KB} KB / ${MAX_JS_KB} KB limit (gzip)"
  if [ "$JS_KB" -le "$MAX_JS_KB" ]; then
    pass "$label_js"
  else
    fail "$label_js"
  fi

  label_css="CSS bundle: ${CSS_KB} KB / ${MAX_CSS_KB} KB limit (gzip)"
  if [ "$CSS_KB" -le "$MAX_CSS_KB" ]; then
    pass "$label_css"
  else
    fail "$label_css"
  fi
else
  echo "  [SKIP] No build output found (.next/static or out/_next/static)."
  echo "         Run 'make build' first for bundle size checks."
  echo ""
fi

# ---------------------------------------------------------------------------
# 2. Image sizes
# ---------------------------------------------------------------------------

MAX_IMAGE_KB=$(read_budget "assets.images.max_individual_kb" || echo "200")

echo ""
echo "  Images (max ${MAX_IMAGE_KB} KB each):"

image_count=0
if [ -d "$PUBLIC_DIR" ]; then
  while IFS= read -r -d '' img; do
    image_count=$((image_count + 1))
    img_kb=$(file_size_kb "$img")
    rel_path="${img#"$SITE_ROOT/"}"
    label="${rel_path}: ${img_kb} KB / ${MAX_IMAGE_KB} KB"
    if [ "$img_kb" -le "$MAX_IMAGE_KB" ]; then
      pass "$label"
    else
      fail "$label"
    fi
  done < <(find "$PUBLIC_DIR" \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.avif" -o -name "*.svg" \) -type f -print0 2>/dev/null)
fi

if [ "$image_count" -eq 0 ]; then
  echo "    (no images found in public/)"
fi

# ---------------------------------------------------------------------------
# 3. Prohibited image formats
# ---------------------------------------------------------------------------

echo ""
echo "  Prohibited formats (.gif, .bmp):"

prohibited_count=0
if [ -d "$PUBLIC_DIR" ]; then
  while IFS= read -r -d '' img; do
    prohibited_count=$((prohibited_count + 1))
    rel_path="${img#"$SITE_ROOT/"}"
    fail "Prohibited format: ${rel_path}"
  done < <(find "$PUBLIC_DIR" \( -name "*.gif" -o -name "*.bmp" \) -type f -print0 2>/dev/null)
fi

if [ "$prohibited_count" -eq 0 ]; then
  pass "No prohibited image formats found"
fi

# ---------------------------------------------------------------------------
# 4. Font family count
# ---------------------------------------------------------------------------

MAX_FONTS=$(read_budget "assets.fonts.max_families" || echo "2")

echo ""

font_count=0
if [ -d "$SITE_ROOT/src" ]; then
  font_count=$(grep -r "next/font" "$SITE_ROOT/src/" 2>/dev/null \
    | grep -oE '\b(Geist|Geist_Mono|Inter|Roboto|Lato|Poppins|Montserrat)\b' \
    | sort -u \
    | wc -l \
    | tr -d ' ')
fi

label_fonts="Font families: ${font_count} / ${MAX_FONTS} limit"
if [ "$font_count" -le "$MAX_FONTS" ]; then
  pass "$label_fonts"
else
  fail "$label_fonts"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
if [ "$fail_count" -eq 0 ]; then
  printf "\033[32mAll performance budget checks passed.\033[0m\n\n"
  exit 0
else
  printf "\033[31m%d violation(s) found. Fix all violations before merge.\033[0m\n\n" "$fail_count"
  exit 1
fi
