package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// QuarantineEntry represents a single quarantined test.
type QuarantineEntry struct {
	Test    string `json:"test"`
	Reason  string `json:"reason"`
	Issue   string `json:"issue"`
	Added   string `json:"added"`
	Expires string `json:"expires"`
}

// QuarantineFile represents the quarantine.json schema.
type QuarantineFile struct {
	Description string            `json:"description,omitempty"`
	Quarantined []QuarantineEntry `json:"quarantined"`
}

// LoadQuarantine reads and parses the quarantine.json file. Returns an empty
// QuarantineFile if the path is empty or the file does not exist.
func LoadQuarantine(path string) (*QuarantineFile, error) {
	if path == "" {
		return &QuarantineFile{}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &QuarantineFile{}, nil
		}
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var qf QuarantineFile
	if err := json.Unmarshal(data, &qf); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	return &qf, nil
}

// QuarantinedNames returns the set of quarantined test name patterns.
func (qf *QuarantineFile) QuarantinedNames() map[string]QuarantineEntry {
	m := make(map[string]QuarantineEntry, len(qf.Quarantined))
	for _, e := range qf.Quarantined {
		m[e.Test] = e
	}
	return m
}

// ExpiredEntries returns quarantine entries past their expiry date.
func (qf *QuarantineFile) ExpiredEntries(now time.Time) []QuarantineEntry {
	var expired []QuarantineEntry
	for _, e := range qf.Quarantined {
		if e.Expires == "" {
			continue
		}
		t, err := time.Parse("2006-01-02", e.Expires)
		if err != nil {
			continue
		}
		if now.After(t) {
			expired = append(expired, e)
		}
	}
	return expired
}
