// Package bootstrap provides utilities for reading and displaying bootstrap state.
//
// The bootstrap process runs on server startup to ensure essential skills and system
// agents are available. This package allows the CLI to query and display that state
// without going through gRPC (consistent with how server status reads PID files directly).
//
// The bootstrap state is stored in SQLite at ~/.stigmer/stigmer.db in the bootstrap_state table.
package bootstrap

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	// Pure Go SQLite driver - no CGO required
	_ "modernc.org/sqlite"
)

// Status constants matching bootstrap package
const (
	StatusPending    = "pending"
	StatusInProgress = "in_progress"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
)

// Key prefixes for bootstrap_state table
const (
	KeySeedpackVersion = "seedpack_version"
	KeyBootstrapStatus = "bootstrap_status"
	KeySkillPrefix     = "skill:"
	KeyAgentPrefix     = "agent:"
	KeyAppliedPrefix   = "applied:"
)

// BootstrapStatus represents the bootstrap state for display.
type BootstrapStatus struct {
	// Status is the overall bootstrap status (completed, failed, in_progress, pending, or empty if never run)
	Status string
	// Version is the seedpack version that was bootstrapped
	Version string
	// Skills contains the state of each bootstrapped skill
	Skills []ResourceState
	// Agents contains the state of each bootstrapped agent
	Agents []ResourceState
}

// ResourceState represents the state of a bootstrapped resource (skill or agent).
type ResourceState struct {
	// Name is the resource name (e.g., "skill-creator")
	Name string
	// State is the full state string (e.g., "applied:sha256:abc123...")
	State string
	// Digest is the extracted digest from the state (e.g., "sha256:abc123...")
	Digest string
}

// GetBootstrapStatus reads bootstrap state from SQLite.
//
// The database is expected at ~/.stigmer/stigmer.db.
// Returns nil with no error if the database doesn't exist (server never started).
func GetBootstrapStatus() (*BootstrapStatus, error) {
	dbPath, err := getDBPath()
	if err != nil {
		return nil, fmt.Errorf("get database path: %w", err)
	}

	// Check if database exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		// Database doesn't exist - bootstrap never ran
		return &BootstrapStatus{
			Status: "",
			Skills: []ResourceState{},
			Agents: []ResourceState{},
		}, nil
	}

	// Open database in read-only mode
	db, err := sql.Open("sqlite", dbPath+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	// Query all bootstrap state
	ctx := context.Background()
	stateMap, err := getAllBootstrapState(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("query bootstrap state: %w", err)
	}

	// Parse state into structured format
	return parseBootstrapState(stateMap), nil
}

// getDBPath returns the path to the SQLite database (~/.stigmer/stigmer.db)
func getDBPath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".stigmer", "stigmer.db"), nil
}

// getAllBootstrapState reads all key-value pairs from the bootstrap_state table.
func getAllBootstrapState(ctx context.Context, db *sql.DB) (map[string]string, error) {
	// First check if the table exists
	var tableName string
	err := db.QueryRowContext(ctx,
		`SELECT name FROM sqlite_master WHERE type='table' AND name='bootstrap_state'`).Scan(&tableName)
	if err == sql.ErrNoRows {
		// Table doesn't exist - bootstrap never ran (old schema)
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("check table exists: %w", err)
	}

	rows, err := db.QueryContext(ctx, `SELECT key, value FROM bootstrap_state`)
	if err != nil {
		return nil, fmt.Errorf("query bootstrap_state: %w", err)
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		result[key] = value
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return result, nil
}

// parseBootstrapState converts raw key-value state into structured BootstrapStatus.
func parseBootstrapState(stateMap map[string]string) *BootstrapStatus {
	status := &BootstrapStatus{
		Status:  stateMap[KeyBootstrapStatus],
		Version: stateMap[KeySeedpackVersion],
		Skills:  []ResourceState{},
		Agents:  []ResourceState{},
	}

	for key, value := range stateMap {
		if strings.HasPrefix(key, KeySkillPrefix) {
			name := strings.TrimPrefix(key, KeySkillPrefix)
			status.Skills = append(status.Skills, ResourceState{
				Name:   name,
				State:  value,
				Digest: extractDigest(value),
			})
		} else if strings.HasPrefix(key, KeyAgentPrefix) {
			name := strings.TrimPrefix(key, KeyAgentPrefix)
			status.Agents = append(status.Agents, ResourceState{
				Name:   name,
				State:  value,
				Digest: extractDigest(value),
			})
		}
	}

	return status
}

// extractDigest extracts the digest from a state value like "applied:sha256:abc123..."
func extractDigest(state string) string {
	if strings.HasPrefix(state, KeyAppliedPrefix) {
		return strings.TrimPrefix(state, KeyAppliedPrefix)
	}
	return state
}

// GetStatusSymbol returns a visual indicator for bootstrap status.
func GetStatusSymbol(status string) string {
	switch status {
	case StatusCompleted:
		return "✓"
	case StatusFailed:
		return "✗"
	case StatusInProgress:
		return "↻"
	case StatusPending:
		return "○"
	case "":
		return "○" // Never bootstrapped
	default:
		return "?"
	}
}

// GetStatusDisplay returns a user-friendly display string for bootstrap status.
func GetStatusDisplay(status string) string {
	switch status {
	case StatusCompleted:
		return "Completed"
	case StatusFailed:
		return "Failed"
	case StatusInProgress:
		return "In Progress"
	case StatusPending:
		return "Pending"
	case "":
		return "Not Started"
	default:
		return status
	}
}

// FormatResourceNames formats resource names for display (e.g., "skill-creator, yaml-validator")
func FormatResourceNames(resources []ResourceState) string {
	if len(resources) == 0 {
		return "none"
	}
	names := make([]string, len(resources))
	for i, r := range resources {
		names[i] = r.Name
	}
	return strings.Join(names, ", ")
}
