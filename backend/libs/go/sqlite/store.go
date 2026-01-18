// Package sqlite provides a generic resource storage layer using SQLite with JSON documents.
// This implements the "Single Bucket" pattern from ADR-007 to avoid migration hell.
package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// Store manages SQLite database connections and operations
type Store struct {
	db *sql.DB
}

// Resource represents a generic resource record
type Resource struct {
	ID        string
	Kind      string
	OrgID     string
	ProjectID string
	Data      []byte
	UpdatedAt time.Time
}

// NewStore creates a new SQLite store at the given path
func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable foreign keys and WAL mode for better concurrency
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	store := &Store{db: db}

	// Initialize schema
	if err := store.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return store, nil
}

// initSchema creates the resources table and indices
func (s *Store) initSchema() error {
	schema := `
		CREATE TABLE IF NOT EXISTS resources (
			id TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			org_id TEXT DEFAULT '',
			project_id TEXT DEFAULT '',
			data JSON NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_resource_kind ON resources(kind);
		CREATE INDEX IF NOT EXISTS idx_resource_org ON resources(org_id);
		CREATE INDEX IF NOT EXISTS idx_resource_project ON resources(project_id);
	`

	_, err := s.db.Exec(schema)
	return err
}

// SaveResource saves a proto message to the resources table
// This is a universal upsert operation that works for any resource kind
func (s *Store) SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error {
	// Marshal proto to JSON
	data, err := protojson.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal proto to JSON: %w", err)
	}

	// Extract org_id and project_id if present in the message
	orgID := extractFieldString(msg, "metadata", "org_id")
	projectID := extractFieldString(msg, "metadata", "project_id")

	// Upsert using INSERT ... ON CONFLICT
	query := `
		INSERT INTO resources (id, kind, org_id, project_id, data)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			kind = excluded.kind,
			org_id = excluded.org_id,
			project_id = excluded.project_id,
			data = excluded.data,
			updated_at = CURRENT_TIMESTAMP
	`

	_, err = s.db.ExecContext(ctx, query, id, kind, orgID, projectID, string(data))
	if err != nil {
		return fmt.Errorf("failed to save resource: %w", err)
	}

	return nil
}

// GetResource retrieves a resource by ID and unmarshals into the provided proto message
func (s *Store) GetResource(ctx context.Context, id string, msg proto.Message) error {
	var data string
	query := "SELECT data FROM resources WHERE id = ?"

	err := s.db.QueryRowContext(ctx, query, id).Scan(&data)
	if err == sql.ErrNoRows {
		return fmt.Errorf("resource not found: %s", id)
	}
	if err != nil {
		return fmt.Errorf("failed to query resource: %w", err)
	}

	// Unmarshal JSON to proto
	if err := protojson.Unmarshal([]byte(data), msg); err != nil {
		return fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
	}

	return nil
}

// ListResources retrieves all resources of a given kind
func (s *Store) ListResources(ctx context.Context, kind string) ([][]byte, error) {
	query := "SELECT data FROM resources WHERE kind = ? ORDER BY updated_at DESC"

	rows, err := s.db.QueryContext(ctx, query, kind)
	if err != nil {
		return nil, fmt.Errorf("failed to query resources: %w", err)
	}
	defer rows.Close()

	var results [][]byte
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		results = append(results, []byte(data))
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	return results, nil
}

// ListResourcesByOrg retrieves all resources of a given kind for an organization
func (s *Store) ListResourcesByOrg(ctx context.Context, kind string, orgID string) ([][]byte, error) {
	query := "SELECT data FROM resources WHERE kind = ? AND org_id = ? ORDER BY updated_at DESC"

	rows, err := s.db.QueryContext(ctx, query, kind, orgID)
	if err != nil {
		return nil, fmt.Errorf("failed to query resources: %w", err)
	}
	defer rows.Close()

	var results [][]byte
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		results = append(results, []byte(data))
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	return results, nil
}

// DeleteResource deletes a resource by ID
func (s *Store) DeleteResource(ctx context.Context, id string) error {
	query := "DELETE FROM resources WHERE id = ?"

	result, err := s.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete resource: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("resource not found: %s", id)
	}

	return nil
}

// DeleteResourcesByKind deletes all resources of a given kind
func (s *Store) DeleteResourcesByKind(ctx context.Context, kind string) (int64, error) {
	query := "DELETE FROM resources WHERE kind = ?"

	result, err := s.db.ExecContext(ctx, query, kind)
	if err != nil {
		return 0, fmt.Errorf("failed to delete resources: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return rowsAffected, nil
}

// Close closes the database connection
func (s *Store) Close() error {
	return s.db.Close()
}

// extractFieldString extracts a string field from a proto message using reflection
// Returns empty string if field doesn't exist or is not a string
func extractFieldString(msg proto.Message, parentField string, fieldName string) string {
	if msg == nil {
		return ""
	}

	msgReflect := msg.ProtoReflect()
	fields := msgReflect.Descriptor().Fields()

	// Find parent field (e.g., "metadata")
	parentFieldDesc := fields.ByName(protoreflect.Name(parentField))
	if parentFieldDesc == nil {
		return ""
	}

	// Get parent message
	parentMsg := msgReflect.Get(parentFieldDesc).Message()
	if !parentMsg.IsValid() {
		return ""
	}

	// Find child field (e.g., "org_id")
	childFieldDesc := parentMsg.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if childFieldDesc == nil {
		return ""
	}

	// Get field value
	value := parentMsg.Get(childFieldDesc)
	if !value.IsValid() {
		return ""
	}

	// Return string value
	return value.String()
}
