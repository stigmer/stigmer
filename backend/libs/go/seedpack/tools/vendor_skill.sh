#!/usr/bin/env bash
# ==============================================================================
# vendor_skill.sh - Vendor skills from the Anthropic skills repository
# ==============================================================================
#
# This script vendors a skill from Anthropic's public skills repository into
# Stigmer's seedpack directory with full provenance tracking.
#
# Usage:
#   ./vendor_skill.sh <skill-name> [commit-sha]
#
# Arguments:
#   skill-name   Name of the skill to vendor (e.g., "skill-creator")
#   commit-sha   Optional: specific commit SHA to pin to (defaults to HEAD)
#
# Output:
#   Creates/updates the skill directory under ../skills/<skill-name>/
#   Generates provenance.json with full origin tracking
#
# Requirements:
#   - git
#   - sha256sum (Linux) or shasum (macOS)
#   - jq (for JSON generation)
#
# Example:
#   ./vendor_skill.sh skill-creator
#   ./vendor_skill.sh skill-creator abc123def456789...
#
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

readonly UPSTREAM_REPO="https://github.com/anthropics/skills"
readonly UPSTREAM_REF="main"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SEEDPACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly SKILLS_DIR="${SEEDPACK_DIR}/skills"
readonly PROVENANCE_SCHEMA_VERSION="1"

# Build artifacts directory (for pre-built ZIPs)
readonly ARTIFACTS_DIR="${SEEDPACK_DIR}/artifacts"

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
    
    if ! command -v zip &>/dev/null; then
        missing+=("zip")
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
    local requested_commit="${2:-}"
    
    TEMP_DIR=$(mktemp -d)
    trap cleanup EXIT
    
    log_info "Vendoring skill: ${skill_name}"
    log_info "Upstream repository: ${UPSTREAM_REPO}"
    
    # Clone the repository
    log_info "Cloning repository to temporary directory..."
    if [[ -n "$requested_commit" ]]; then
        # Full clone needed to checkout specific commit
        git clone --quiet "$UPSTREAM_REPO" "$TEMP_DIR/repo"
        cd "$TEMP_DIR/repo"
        git checkout --quiet "$requested_commit"
    else
        # Shallow clone for HEAD is faster
        git clone --quiet --depth 1 --branch "$UPSTREAM_REF" "$UPSTREAM_REPO" "$TEMP_DIR/repo"
        cd "$TEMP_DIR/repo"
    fi
    
    # Capture the actual commit SHA
    local commit_sha
    commit_sha=$(git rev-parse HEAD)
    log_info "Commit SHA: ${commit_sha}"
    
    # Verify the skill exists in upstream
    local upstream_skill_dir="$TEMP_DIR/repo/skills/${skill_name}"
    if [[ ! -d "$upstream_skill_dir" ]]; then
        log_error "Skill '${skill_name}' not found in upstream repository"
        log_error "Available skills:"
        ls -1 "$TEMP_DIR/repo/skills/" >&2 || true
        exit 1
    fi
    
    # Verify SKILL.md exists
    if [[ ! -f "$upstream_skill_dir/SKILL.md" ]]; then
        log_error "SKILL.md not found in skill directory"
        exit 1
    fi
    
    # Prepare destination directory
    local dest_dir="${SKILLS_DIR}/${skill_name}"
    log_info "Destination: ${dest_dir}"
    
    # Remove existing vendored content (but preserve provenance for comparison)
    local old_provenance=""
    if [[ -f "$dest_dir/provenance.json" ]]; then
        old_provenance=$(cat "$dest_dir/provenance.json")
    fi
    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"
    
    # Copy skill content
    log_info "Copying skill content..."
    cp -r "$upstream_skill_dir"/* "$dest_dir/"
    
    # Generate per-file digests
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
    
    # Calculate overall content digest
    local content_digest
    content_digest=$(calculate_content_digest "$dest_dir")
    log_info "Content digest: sha256:${content_digest}"
    
    # Generate provenance.json
    local vendored_at
    vendored_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    log_info "Generating provenance.json..."
    jq -n \
        --arg schema_version "$PROVENANCE_SCHEMA_VERSION" \
        --arg source_type "git" \
        --arg url "$UPSTREAM_REPO" \
        --arg ref "$UPSTREAM_REF" \
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
    
    # -------------------------------------------------------------------------
    # Create pre-built ZIP artifact for bootstrap
    # -------------------------------------------------------------------------
    # The ZIP is created in the same format as the CLI's artifact.PushSkill
    # expects: a ZIP containing the skill files without provenance.json.
    # This enables the server to bootstrap skills without any ZIP creation
    # logic at runtime - just load bytes and call the Push API.
    # -------------------------------------------------------------------------
    
    log_info "Creating pre-built ZIP artifact..."
    mkdir -p "$ARTIFACTS_DIR"
    
    local artifact_path="${ARTIFACTS_DIR}/${skill_name}.zip"
    
    # Create ZIP from skill directory, excluding provenance.json
    # (provenance is metadata for us, not part of the skill artifact)
    (
        cd "$dest_dir"
        # Use -r for recursive, -q for quiet
        # Exclude provenance.json as it's not part of the skill content
        zip -rq "$artifact_path" . -x "provenance.json"
    )
    
    # Calculate artifact digest
    local artifact_digest
    artifact_digest=$(calculate_sha256 "$artifact_path")
    log_info "Artifact created: ${artifact_path}"
    log_info "Artifact digest: sha256:${artifact_digest}"
    
    # Store artifact info for manifest update (caller can parse this)
    echo ""
    echo "ARTIFACT_INFO:"
    echo "  artifact_path: artifacts/${skill_name}.zip"
    echo "  artifact_digest: sha256:${artifact_digest}"
    
    # Summary
    log_success "Successfully vendored '${skill_name}'"
    echo ""
    echo "Vendored files:"
    find "$dest_dir" -type f | sed "s|${dest_dir}/|  |" | sort
    echo ""
    echo "Provenance:"
    echo "  Repository: ${UPSTREAM_REPO}"
    echo "  Commit:     ${commit_sha}"
    echo "  Digest:     sha256:${content_digest}"
    echo "  Vendored:   ${vendored_at}"
    echo ""
    echo "Pre-built artifact:"
    echo "  Path:   artifacts/${skill_name}.zip"
    echo "  Digest: sha256:${artifact_digest}"
    
    # Show diff if re-vendoring
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
}

# ------------------------------------------------------------------------------
# Usage and main entry point
# ------------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <skill-name> [commit-sha]

Vendor a skill from the Anthropic skills repository into Stigmer's seedpack.

Arguments:
  skill-name   Name of the skill to vendor (e.g., "skill-creator")
  commit-sha   Optional: specific commit SHA to pin to (defaults to HEAD)

Examples:
  $(basename "$0") skill-creator
  $(basename "$0") skill-creator abc123def456789...

EOF
}

main() {
    if [[ $# -lt 1 ]]; then
        usage
        exit 1
    fi
    
    local skill_name="$1"
    local commit_sha="${2:-}"
    
    check_dependencies
    vendor_skill "$skill_name" "$commit_sha"
}

main "$@"
