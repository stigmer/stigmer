package nodert

import (
	"encoding/json"
	"os"
	"time"

	"github.com/pkg/errors"
)

const manifestSchemaVersion = 1

// Manifest records the immutable state of a bootstrapped Node.js runtime
// environment. Written once during bootstrap and checked on subsequent
// startups to decide whether the existing environment is still valid.
type Manifest struct {
	SchemaVersion       int       `json:"schema_version"`
	CLIVersion          string    `json:"cli_version"`
	Platform            string    `json:"platform"`
	NodeVersion         string    `json:"node_version"`
	DepsLockSHA256      string    `json:"deps_lock_sha256"`
	InstalledAt         time.Time `json:"installed_at"`
	BootstrapDurationMS int64     `json:"bootstrap_duration_ms"`
}

// ReadManifest reads and parses a manifest from the given file path.
func ReadManifest(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read manifest file")
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, errors.Wrap(err, "failed to parse manifest JSON")
	}
	return &m, nil
}

// Write serializes the manifest as indented JSON to the given file path.
func (m *Manifest) Write(path string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return errors.Wrap(err, "failed to marshal manifest to JSON")
	}
	if err := os.WriteFile(path, append(data, '\n'), 0644); err != nil {
		return errors.Wrap(err, "failed to write manifest file")
	}
	return nil
}

// IsValid reports whether this manifest represents a runtime that matches
// the given CLI version and a recognized schema.
func (m *Manifest) IsValid(cliVersion string) bool {
	if m.SchemaVersion != manifestSchemaVersion {
		return false
	}
	return m.CLIVersion == cliVersion
}
