#!/usr/bin/env bash
# ==============================================================================
# vendor_skill.sh - Vendor skills declared in vendor-sources.json
# ==============================================================================
#
# This script vendors skills from upstream repositories into Stigmer's seedpack
# directory with full provenance tracking. Skill sources (repo URLs and pinned
# commits) are read from the co-located vendor-sources.json.
#
# Usage:
#   ./vendor_skill.sh                              # vendor all skills
#   ./vendor_skill.sh <skill-name>                 # vendor one skill
#   ./vendor_skill.sh <skill-name> [commit-sha]    # vendor at specific commit
#
# Output:
#   Creates/updates skill directories under ../skills/<skill-name>/
#   Generates provenance.json with full origin tracking per skill
#
# Requirements:
#   - git
#   - sha256sum (Linux) or shasum (macOS)
#   - jq (for JSON generation)
#
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SEEDPACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly SKILLS_DIR="${SEEDPACK_DIR}/skills"
readonly VENDOR_SOURCES="${SCRIPT_DIR}/vendor-sources.json"
readonly PROVENANCE_SCHEMA_VERSION="1"


# ------------------------------------------------------------------------------
# Logging utilities
# ------------------------------------------------------------------------------

log_info() {
    echo "[INFO] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_success() {
    echo "[SUCCESS] $*" >&2
}

# ------------------------------------------------------------------------------
# Platform-agnostic SHA256 calculation
# ------------------------------------------------------------------------------

calculate_sha256() {
    local file="$1"
    if command -v sha256sum &>/dev/null; then
        sha256sum "$file" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$file" | cut -d' ' -f1
    else
        log_error "Neither sha256sum nor shasum found. Cannot calculate digests."
        exit 1
    fi
}

# Calculate content digest for a directory (all files, sorted, concatenated hashes)
calculate_content_digest() {
    local dir="$1"
    local combined=""
    
    # Find all files, sort them for reproducibility, calculate each hash
    while IFS= read -r -d '' file; do
        local hash
        hash=$(calculate_sha256 "$file")
        combined="${combined}${hash}"
    done < <(find "$dir" -type f -print0 | sort -z)
    
    # Hash the combined hashes
    echo -n "$combined" | if command -v sha256sum &>/dev/null; then
        sha256sum | cut -d' ' -f1
    else
        shasum -a 256 | cut -d' ' -f1
    fi
}

# ------------------------------------------------------------------------------
# Dependency checks
# ------------------------------------------------------------------------------

check_dependencies() {
    local missing=()
    
    if ! command -v git &>/dev/null; then
        missing+=("git")
    fi
    
    if ! command -v jq &>/dev/null; then
        missing+=("jq")
    fi
    
    if ! command -v sha256sum &>/dev/null && ! command -v shasum &>/dev/null; then
        missing+=("sha256sum or shasum")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing[*]}"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Main vendoring logic
# ------------------------------------------------------------------------------

# Global for cleanup trap
TEMP_DIR=""

cleanup() {
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}

vendor_skill() {
    local skill_name="$1"
    local repo_url="$2"
    local requested_commit="${3:-}"
    local upstream_ref="${4:-main}"
    
    TEMP_DIR=$(mktemp -d)
    trap cleanup EXIT
    
    log_info "Vendoring skill: ${skill_name}"
    log_info "Upstream repository: ${repo_url}"
    
    log_info "Cloning repository to temporary directory..."
    if [[ -n "$requested_commit" ]]; then
        git clone --quiet "$repo_url" "$TEMP_DIR/repo"
        git -C "$TEMP_DIR/repo" checkout --quiet "$requested_commit"
    else
        git clone --quiet --depth 1 --branch "$upstream_ref" "$repo_url" "$TEMP_DIR/repo"
    fi
    
    local commit_sha
    commit_sha=$(git -C "$TEMP_DIR/repo" rev-parse HEAD)
    log_info "Commit SHA: ${commit_sha}"
    
    local upstream_skill_dir="$TEMP_DIR/repo/skills/${skill_name}"
    if [[ ! -d "$upstream_skill_dir" ]]; then
        log_error "Skill '${skill_name}' not found in upstream repository"
        log_error "Available skills:"
        ls -1 "$TEMP_DIR/repo/skills/" >&2 || true
        return 1
    fi
    
    if [[ ! -f "$upstream_skill_dir/SKILL.md" ]]; then
        log_error "SKILL.md not found in skill directory"
        return 1
    fi
    
    local dest_dir="${SKILLS_DIR}/${skill_name}"
    log_info "Destination: ${dest_dir}"
    
    local old_provenance=""
    if [[ -f "$dest_dir/provenance.json" ]]; then
        old_provenance=$(cat "$dest_dir/provenance.json")
    fi
    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"
    
    log_info "Copying skill content..."
    cp -r "$upstream_skill_dir"/* "$dest_dir/"
    
    log_info "Calculating file digests..."
    local files_json="["
    local first=true
    while IFS= read -r -d '' file; do
        local rel_path="${file#${dest_dir}/}"
        local file_hash
        file_hash=$(calculate_sha256 "$file")
        
        if [[ "$first" == "true" ]]; then
            first=false
        else
            files_json="${files_json},"
        fi
        files_json="${files_json}{\"path\":\"${rel_path}\",\"digest\":\"sha256:${file_hash}\"}"
    done < <(find "$dest_dir" -type f ! -name "provenance.json" -print0 | sort -z)
    files_json="${files_json}]"
    
    local content_digest
    content_digest=$(calculate_content_digest "$dest_dir")
    log_info "Content digest: sha256:${content_digest}"
    
    local vendored_at
    vendored_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    log_info "Generating provenance.json..."
    jq -n \
        --arg schema_version "$PROVENANCE_SCHEMA_VERSION" \
        --arg source_type "git" \
        --arg url "$repo_url" \
        --arg ref "$upstream_ref" \
        --arg commit_sha "$commit_sha" \
        --arg subdir "skills/${skill_name}" \
        --arg vendored_at "$vendored_at" \
        --arg vendored_by "vendor_skill.sh" \
        --arg content_digest "sha256:${content_digest}" \
        --argjson files "$files_json" \
        '{
            schema_version: $schema_version,
            source: {
                type: $source_type,
                url: $url,
                ref: $ref,
                commit_sha: $commit_sha,
                subdir: $subdir
            },
            vendored_at: $vendored_at,
            vendored_by: $vendored_by,
            content_digest: $content_digest,
            files: $files
        }' > "$dest_dir/provenance.json"
    
    log_success "Successfully vendored '${skill_name}'"
    echo ""
    echo "Vendored files:"
    find "$dest_dir" -type f | sed "s|${dest_dir}/|  |" | sort
    echo ""
    echo "Provenance:"
    echo "  Repository: ${repo_url}"
    echo "  Commit:     ${commit_sha}"
    echo "  Digest:     sha256:${content_digest}"
    echo "  Vendored:   ${vendored_at}"
    
    if [[ -n "$old_provenance" ]]; then
        local old_commit
        local old_digest
        old_commit=$(echo "$old_provenance" | jq -r '.source.commit_sha // "unknown"')
        old_digest=$(echo "$old_provenance" | jq -r '.content_digest // "unknown"')
        
        if [[ "$old_commit" != "$commit_sha" ]] || [[ "$old_digest" != "sha256:${content_digest}" ]]; then
            echo ""
            echo "Changes detected from previous version:"
            echo "  Previous commit: ${old_commit}"
            echo "  New commit:      ${commit_sha}"
            echo "  Previous digest: ${old_digest}"
            echo "  New digest:      sha256:${content_digest}"
        fi
    fi
    
    # Clean up temp dir between skills
    rm -rf "$TEMP_DIR"
    TEMP_DIR=""
}

# Vendor all skills declared in vendor-sources.json
vendor_all_from_sources() {
    if [[ ! -f "$VENDOR_SOURCES" ]]; then
        log_error "Vendor sources not found: ${VENDOR_SOURCES}"
        exit 1
    fi
    
    local skill_count
    skill_count=$(jq '.skills | length' "$VENDOR_SOURCES")
    
    if [[ "$skill_count" -eq 0 ]]; then
        log_error "No skills declared in vendor-sources.json"
        exit 1
    fi
    
    log_info "Found ${skill_count} skill(s) in vendor-sources.json"
    echo ""
    
    local failed=0
    for i in $(seq 0 $((skill_count - 1))); do
        local name url commit_sha
        name=$(jq -r ".skills[$i].name" "$VENDOR_SOURCES")
        url=$(jq -r ".skills[$i].source.url" "$VENDOR_SOURCES")
        commit_sha=$(jq -r ".skills[$i].source.commit_sha // empty" "$VENDOR_SOURCES")
        
        log_info "--- [$((i + 1))/${skill_count}] ${name} ---"
        
        if ! vendor_skill "$name" "$url" "$commit_sha"; then
            log_error "Failed to vendor '${name}', continuing..."
            failed=$((failed + 1))
        fi
        echo ""
    done
    
    if [[ "$failed" -gt 0 ]]; then
        log_error "${failed} skill(s) failed to vendor"
        exit 1
    fi
    
    log_success "All ${skill_count} skill(s) vendored successfully"
}

# ------------------------------------------------------------------------------
# Usage and main entry point
# ------------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") [skill-name] [commit-sha]

Vendor skills from upstream repositories into Stigmer's seedpack.

When run with no arguments, vendors all skills declared in vendor-sources.json.
When a skill name is given, vendors only that skill using its vendor-sources entry.

Arguments:
  skill-name   Optional: name of a single skill to vendor (e.g., "skill-creator")
  commit-sha   Optional: specific commit SHA to pin to (overrides vendor-sources)

Examples:
  $(basename "$0")                                    # vendor all skills
  $(basename "$0") skill-creator                      # vendor one skill
  $(basename "$0") skill-creator abc123def456789...   # vendor at specific commit

EOF
}

main() {
    check_dependencies
    
    if [[ $# -eq 0 ]]; then
        vendor_all_from_sources
        return
    fi
    
    local skill_name="$1"
    local commit_override="${2:-}"
    
    if [[ ! -f "$VENDOR_SOURCES" ]]; then
        log_error "Vendor sources not found: ${VENDOR_SOURCES}"
        exit 1
    fi
    
    local url commit_sha
    url=$(jq -r --arg name "$skill_name" '.skills[] | select(.name == $name) | .source.url // empty' "$VENDOR_SOURCES")
    commit_sha=$(jq -r --arg name "$skill_name" '.skills[] | select(.name == $name) | .source.commit_sha // empty' "$VENDOR_SOURCES")
    
    if [[ -z "$url" ]]; then
        log_error "Skill '${skill_name}' not found in vendor-sources.json"
        log_error "Available skills:"
        jq -r '.skills[].name' "$VENDOR_SOURCES" >&2
        exit 1
    fi
    
    # CLI commit override takes precedence over manifest
    if [[ -n "$commit_override" ]]; then
        commit_sha="$commit_override"
    fi
    
    vendor_skill "$skill_name" "$url" "$commit_sha"
}

main "$@"
