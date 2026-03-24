// Package seedpackbootstrap extracts and applies the embedded seedpack
// to the currently configured Stigmer backend (local or cloud).
//
// The bootstrap runs in two phases to respect the resource hierarchy:
//  1. Apply organizations — the root of the resource hierarchy.
//  2. Apply the project — agents, skills, MCP servers under the organization.
//
// Both phases use `stigmer apply` as a subprocess, ensuring the same code
// path handles seedpack resources and user-authored resources. This works
// against whatever backend the CLI is configured for (local daemon or cloud).
package seedpackbootstrap

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/seedpack"
)

const (
	recursionGuardEnvVar = "STIGMER_SKIP_SEEDPACK_BOOTSTRAP"
	markerFileName       = ".seedpack-bootstrapped"
	defaultOrg           = "stigmer"
	orgEnvVar            = "STIGMER_SEEDPACK_ORG"
)

// Options configures seedpack bootstrap behavior.
type Options struct {
	// MarkerDir is the directory for the idempotency marker file.
	// When empty, the hash-based skip check is disabled and every
	// invocation applies the seedpack unconditionally (unless Force
	// is false and the caller handles idempotency externally).
	MarkerDir string

	// Org is the target organization slug for seedpack resources.
	// Defaults to "stigmer". Also respects STIGMER_SEEDPACK_ORG env var.
	Org string

	// Force skips the content-hash check and always re-applies.
	Force bool

	// Verbose streams apply output to stderr instead of buffering it.
	Verbose bool
}

// resolveOrg returns the target organization, following the priority chain:
// explicit option > STIGMER_SEEDPACK_ORG env var > default ("stigmer").
func (o *Options) resolveOrg() string {
	if o.Org != "" {
		return o.Org
	}
	if envOrg := os.Getenv(orgEnvVar); envOrg != "" {
		return envOrg
	}
	return defaultOrg
}

// Apply extracts the embedded seedpack and applies it to the configured backend.
// It returns true if the seedpack was actually applied, or false if it was
// skipped (already up to date or recursion guard).
//
// When MarkerDir is set and Force is false, a content-hash check skips the
// apply if the seedpack has not changed since the last successful run.
func Apply(opts Options) (bool, error) {
	if os.Getenv(recursionGuardEnvVar) == "1" {
		log.Debug().Msg("Seedpack bootstrap skipped (recursion guard)")
		return false, nil
	}

	if !opts.Force && opts.MarkerDir != "" {
		skip, err := isAlreadyApplied(opts.MarkerDir)
		if err != nil {
			return false, err
		}
		if skip {
			return false, nil
		}
	}

	climsg.Info("Applying system resources (seedpack)...")

	tmpDir, err := os.MkdirTemp("", "stigmer-seedpack-*")
	if err != nil {
		return false, errors.Wrap(err, "failed to create temp directory for seedpack")
	}
	defer os.RemoveAll(tmpDir)

	if err := seedpack.ExtractToDir(tmpDir); err != nil {
		return false, errors.Wrap(err, "failed to extract seedpack")
	}

	cliBin, err := os.Executable()
	if err != nil {
		return false, errors.Wrap(err, "failed to resolve CLI executable path")
	}

	if err := applyOrganizations(cliBin, tmpDir, opts.Verbose); err != nil {
		return false, err
	}

	if err := applyProject(cliBin, tmpDir, opts.resolveOrg(), opts.Verbose); err != nil {
		return false, err
	}

	if opts.MarkerDir != "" {
		writeMarker(opts.MarkerDir)
	}

	climsg.Success("System resources applied successfully")
	return true, nil
}

// isAlreadyApplied compares the embedded seedpack's content hash with the
// previously stored hash in the marker file.
func isAlreadyApplied(markerDir string) (bool, error) {
	currentHash, err := seedpack.ContentHash()
	if err != nil {
		return false, errors.Wrap(err, "failed to compute seedpack content hash")
	}

	markerPath := filepath.Join(markerDir, markerFileName)
	storedHash, err := os.ReadFile(markerPath)
	if err != nil {
		return false, nil
	}

	if strings.TrimSpace(string(storedHash)) == currentHash {
		log.Debug().Str("hash", currentHash).Msg("Seedpack already applied (hash matches)")
		return true, nil
	}

	log.Info().
		Str("current_hash", currentHash).
		Str("stored_hash", strings.TrimSpace(string(storedHash))).
		Msg("Seedpack hash mismatch — re-apply required")

	return false, nil
}

// writeMarker persists the current seedpack content hash so that future
// runs can skip re-applying unchanged content.
func writeMarker(markerDir string) {
	hash, err := seedpack.ContentHash()
	if err != nil {
		log.Warn().Err(err).Msg("Failed to compute seedpack hash for marker file")
		return
	}

	if err := os.MkdirAll(markerDir, 0755); err != nil {
		log.Warn().Err(err).Msg("Failed to create marker directory")
		return
	}

	markerPath := filepath.Join(markerDir, markerFileName)
	if err := os.WriteFile(markerPath, []byte(hash), 0644); err != nil {
		log.Warn().Err(err).Msg("Failed to write seedpack marker file")
	}
}
