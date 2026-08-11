// Package sqlite implements the store.Store interface using SQLite with the
// pure Go modernc.org/sqlite driver. This provides an embedded database with
// excellent tooling support (sqlite3 CLI, DataGrip, DB Browser, etc.).
package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	// Pure Go SQLite driver - no CGO required
	_ "modernc.org/sqlite"
)

// Schema version constants for migration tracking
const (
	// schemaVersion1: Initial schema with single resources table (key-value style)
	schemaVersion1 = 1
	// schemaVersion2: Separate audit table with foreign keys for proper relational design
	schemaVersion2 = 2
	// schemaVersion3: FTS5 full-text search index for unified search
	schemaVersion3 = 3
	// schemaVersion4: Bootstrap state tracking for seedpack initialization
	schemaVersion4 = 4
	// schemaVersion5: Workflow execution events table for event log persistence
	schemaVersion5 = 5
	// schemaVersion6: Schedule runs table — the fire ledger (project DD-017)
	schemaVersion6 = 6

	// currentSchemaVersion is the target version for new databases
	currentSchemaVersion = schemaVersion6
)

// Store implements store.Store using SQLite as the backing storage.
// It uses a single table with (kind, id) as the composite primary key,
// storing protobuf-serialized data as BLOBs.
//
// SQLite only supports a single writer at a time. This implementation uses
// a write mutex to serialize all write operations, which is appropriate for
// the local daemon use case where write contention is minimal.
type Store struct {
	db      *sql.DB
	path    string
	mu      sync.RWMutex // Protects against concurrent Close() calls
	writeMu sync.Mutex   // Serializes write operations for SQLite
}

// Compile-time assertion that Store implements store.Store
var _ store.Store = (*Store)(nil)

// NewStore creates a new SQLite store at the given path.
// The parent directory will be created if it doesn't exist.
// The database is configured with WAL mode for optimal concurrent access.
func NewStore(dbPath string) (*Store, error) {
	// Create parent directory if needed
	dir := filepath.Dir(dbPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	// Open database connection
	// The modernc.org/sqlite driver registers as "sqlite"
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Configure SQLite for optimal performance and reliability
	// These pragmas must be set in order, with journal_mode first
	pragmas := []struct {
		query   string
		comment string
	}{
		{"PRAGMA journal_mode=WAL", "Write-Ahead Logging for concurrent reads"},
		{"PRAGMA synchronous=NORMAL", "Balance between durability and speed"},
		{"PRAGMA busy_timeout=5000", "Wait up to 5s for locks"},
		{"PRAGMA cache_size=-64000", "64MB page cache"},
		{"PRAGMA foreign_keys=ON", "Enable foreign key constraints for CASCADE DELETE"},
		{"PRAGMA temp_store=MEMORY", "Keep temp tables in memory"},
	}

	for _, p := range pragmas {
		if _, err := db.Exec(p.query); err != nil {
			db.Close()
			return nil, fmt.Errorf("configure database (%s): %w", p.comment, err)
		}
	}

	// Run schema migrations
	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return &Store{db: db, path: dbPath}, nil
}

// runMigrations applies database schema migrations in order.
// Each migration is idempotent and wrapped in a transaction for atomicity.
func runMigrations(db *sql.DB) error {
	// Ensure schema_version table exists for tracking migrations
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`); err != nil {
		return fmt.Errorf("create schema_version table: %w", err)
	}

	// Get current schema version
	currentVersion := getSchemaVersion(db)

	// Apply migrations in order
	if currentVersion < schemaVersion1 {
		if err := migrateToV1(db); err != nil {
			return fmt.Errorf("migrate to v1: %w", err)
		}
	}

	if currentVersion < schemaVersion2 {
		if err := migrateToV2(db); err != nil {
			return fmt.Errorf("migrate to v2: %w", err)
		}
	}

	if currentVersion < schemaVersion3 {
		if err := migrateToV3(db); err != nil {
			return fmt.Errorf("migrate to v3: %w", err)
		}
	}

	if currentVersion < schemaVersion4 {
		if err := migrateToV4(db); err != nil {
			return fmt.Errorf("migrate to v4: %w", err)
		}
	}

	if currentVersion < schemaVersion5 {
		if err := migrateToV5(db); err != nil {
			return fmt.Errorf("migrate to v5: %w", err)
		}
	}

	if currentVersion < schemaVersion6 {
		if err := migrateToV6(db); err != nil {
			return fmt.Errorf("migrate to v6: %w", err)
		}
	}

	return nil
}

// getSchemaVersion returns the current schema version from the database.
// Returns 0 if no version has been recorded yet.
func getSchemaVersion(db *sql.DB) int {
	var version int
	err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&version)
	if err != nil {
		return 0
	}
	return version
}

// setSchemaVersion records a migration version as applied.
func setSchemaVersion(tx *sql.Tx, version int) error {
	_, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (?)`, version)
	return err
}

// migrateToV1 creates the initial resources table.
// This is the original key-value style single-table schema.
func migrateToV1(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// WITHOUT ROWID creates a clustered index on (kind, id) for optimal lookups
	schema := `
		CREATE TABLE IF NOT EXISTS resources (
			kind TEXT NOT NULL,
			id TEXT NOT NULL,
			data BLOB NOT NULL,
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (kind, id)
		) WITHOUT ROWID;

		CREATE INDEX IF NOT EXISTS idx_resources_kind_id ON resources(kind, id);
	`

	if _, err := tx.Exec(schema); err != nil {
		return fmt.Errorf("create resources table: %w", err)
	}

	if err := setSchemaVersion(tx, schemaVersion1); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}

	return tx.Commit()
}

// migrateToV2 creates the dedicated audit table and migrates existing audit records.
// This replaces the legacy prefix-based audit storage with a proper relational model.
//
// Changes:
//   - Creates resource_audit table with foreign key to resources
//   - Migrates existing "skill_audit/<id>/<timestamp>" records to new table
//   - Adds indexes for efficient audit queries by hash, tag, and resource_id
func migrateToV2(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Create the dedicated audit table with proper relational design
	// Note: We use DEFERRABLE INITIALLY DEFERRED for the foreign key to allow
	// inserting audit records during migration before the parent exists (edge case)
	auditSchema := `
		CREATE TABLE IF NOT EXISTS resource_audit (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			kind TEXT NOT NULL,
			resource_id TEXT NOT NULL,
			data BLOB NOT NULL,
			archived_at TEXT NOT NULL DEFAULT (datetime('now')),
			version_hash TEXT,
			tag TEXT
		);

		-- Index for looking up all audit records for a resource (used by ListAuditHistory)
		CREATE INDEX IF NOT EXISTS idx_audit_resource ON resource_audit(kind, resource_id);
		
		-- Index for efficient hash lookups (GetAuditByHash)
		CREATE INDEX IF NOT EXISTS idx_audit_hash ON resource_audit(kind, resource_id, version_hash);
		
		-- Index for tag lookups with timestamp ordering (GetAuditByTag)
		CREATE INDEX IF NOT EXISTS idx_audit_tag ON resource_audit(kind, resource_id, tag, archived_at DESC);
	`

	if _, err := tx.Exec(auditSchema); err != nil {
		return fmt.Errorf("create resource_audit table: %w", err)
	}

	// Migrate existing prefix-based audit records to the new table
	// Pattern: "<type>_audit/<resource_id>/<timestamp>" e.g., "skill_audit/abc-123/1706123456789"
	if err := migrateAuditRecords(tx); err != nil {
		return fmt.Errorf("migrate audit records: %w", err)
	}

	if err := setSchemaVersion(tx, schemaVersion2); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}

	return tx.Commit()
}

// migrateToV3 creates the FTS5 full-text search index table.
// This enables efficient text search across all searchable resources (agents, skills,
// mcp_servers, workflows) with BM25 ranking and porter stemming.
//
// The search_index table stores denormalized searchable fields extracted from resources.
// It is maintained separately from the main resources table and must be explicitly
// updated when resources are created/modified/deleted.
//
// FTS5 Configuration:
//   - tokenize='porter unicode61': Porter stemming + Unicode support
//   - BM25 ranking for relevance scoring
//   - Weighted columns: name (10), description (5), tags (5)
func migrateToV3(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Create the FTS5 virtual table for full-text search
	// The 'porter' tokenizer provides English word stemming (deploy -> deploy, deployment -> deploy)
	// The 'unicode61' tokenizer handles Unicode normalization
	//
	// Columns:
	//   - kind: resource type (for filtering, but still searchable for FTS5)
	//   - resource_id: join key to resources table (UNINDEXED = not searchable)
	//   - name: display name (highest search weight)
	//   - description: resource description
	//   - tags: space-separated tags
	//   - org: organization filter (UNINDEXED = not searchable)
	//   - visibility: public/private filter (UNINDEXED = not searchable)
	//   - created_at: for sorting in list mode (UNINDEXED = not searchable)
	fts5Schema := `
		CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
			kind,
			resource_id UNINDEXED,
			name,
			description,
			tags,
			org UNINDEXED,
			visibility UNINDEXED,
			created_at UNINDEXED,
			tokenize='porter unicode61'
		);
	`

	if _, err := tx.Exec(fts5Schema); err != nil {
		return fmt.Errorf("create search_index FTS5 table: %w", err)
	}

	if err := setSchemaVersion(tx, schemaVersion3); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}

	return tx.Commit()
}

// migrateToV4 creates the bootstrap_state table for tracking seedpack initialization.
// This enables idempotent bootstrap operations by recording:
//   - Overall bootstrap status and seedpack version
//   - Per-resource application state (skills, agents)
//
// The table uses a key-value design for flexibility:
//   - "seedpack_version" -> "1.1.0"
//   - "bootstrap_status" -> "completed" / "pending" / "in_progress" / "failed"
//   - "skill:<name>" -> "applied:<artifact_digest>"
//   - "agent:<name>" -> "applied:<content_hash>"
func migrateToV4(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Key-value table for bootstrap state tracking
	// WITHOUT ROWID for efficient key-based lookups
	schema := `
		CREATE TABLE IF NOT EXISTS bootstrap_state (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		) WITHOUT ROWID;
	`

	if _, err := tx.Exec(schema); err != nil {
		return fmt.Errorf("create bootstrap_state table: %w", err)
	}

	if err := setSchemaVersion(tx, schemaVersion4); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}

	return tx.Commit()
}

// migrateToV5 creates the workflow_execution_events table for persisting
// append-only execution event logs. Events are ordered by (execution_id, sequence_number)
// and support cursor-based pagination and filtering by event type or task name.
func migrateToV5(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	schema := `
		CREATE TABLE IF NOT EXISTS workflow_execution_events (
			execution_id TEXT NOT NULL,
			sequence_number INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			task_name TEXT NOT NULL DEFAULT '',
			data BLOB NOT NULL,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			PRIMARY KEY (execution_id, sequence_number)
		);

		CREATE INDEX IF NOT EXISTS idx_wfee_execution_type
			ON workflow_execution_events(execution_id, event_type);

		CREATE INDEX IF NOT EXISTS idx_wfee_execution_task
			ON workflow_execution_events(execution_id, task_name);
	`

	if _, err := tx.Exec(schema); err != nil {
		return fmt.Errorf("create workflow_execution_events table: %w", err)
	}

	if err := setSchemaVersion(tx, schemaVersion5); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}

	return tx.Commit()
}

// migrateToV6 creates the schedule_runs table — the fire ledger (project
// DD-017 D-7): one row per schedule fire, keyed on the fire identity
// (schedule_id, nominal_fire_time, origin) so writers can UPSERT under
// Temporal retry. Rows for fires that created no execution are the whole
// point — they are the only durable trace of a refused launch gate below
// the auto-pause threshold.
func migrateToV6(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	schema := `
		CREATE TABLE IF NOT EXISTS schedule_runs (
			schedule_id TEXT NOT NULL,
			org TEXT NOT NULL DEFAULT '',
			nominal_fire_time TEXT NOT NULL,
			origin TEXT NOT NULL,
			outcome TEXT NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			execution_id TEXT NOT NULL DEFAULT '',
			recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			completed_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (schedule_id, nominal_fire_time, origin)
		);

		CREATE INDEX IF NOT EXISTS idx_schedule_runs_recency
			ON schedule_runs(schedule_id, recorded_at DESC);
	`

	if _, err := tx.Exec(schema); err != nil {
		return fmt.Errorf("create schedule_runs table: %w", err)
	}

	if err := setSchemaVersion(tx, schemaVersion6); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}

	return tx.Commit()
}

// migrateAuditRecords moves prefix-based audit records to the new resource_audit table.
// This handles the legacy pattern where audit records were stored as:
// kind=skill, id="skill_audit/<resource_id>/<timestamp_nanos>"
func migrateAuditRecords(tx *sql.Tx) error {
	// Find all audit records using the legacy prefix pattern
	// We look for IDs containing "_audit/" which indicates the old pattern
	rows, err := tx.Query(`
		SELECT kind, id, data, updated_at 
		FROM resources 
		WHERE id LIKE '%_audit/%'
	`)
	if err != nil {
		return fmt.Errorf("query audit records: %w", err)
	}
	defer rows.Close()

	// Prepare insert statement for batch efficiency
	insertStmt, err := tx.Prepare(`
		INSERT INTO resource_audit (kind, resource_id, data, archived_at, version_hash, tag)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare insert statement: %w", err)
	}
	defer insertStmt.Close()

	var migratedCount int
	var idsToDelete []string

	for rows.Next() {
		var kind, id, updatedAt string
		var data []byte

		if err := rows.Scan(&kind, &id, &data, &updatedAt); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}

		// Parse the legacy ID format: "<type>_audit/<resource_id>/<timestamp>"
		// Example: "skill_audit/abc-123/1706123456789"
		resourceID, versionHash, tag := parseAuditRecord(id, data)
		if resourceID == "" {
			// Skip malformed records
			continue
		}

		// Insert into new audit table
		if _, err := insertStmt.Exec(kind, resourceID, data, updatedAt, versionHash, tag); err != nil {
			return fmt.Errorf("insert audit record: %w", err)
		}

		idsToDelete = append(idsToDelete, id)
		migratedCount++
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate rows: %w", err)
	}

	// Delete migrated records from the resources table
	if len(idsToDelete) > 0 {
		// Use a single DELETE with IN clause for efficiency
		// Build placeholders for the IN clause
		placeholders := make([]string, len(idsToDelete))
		args := make([]interface{}, len(idsToDelete))
		for i, id := range idsToDelete {
			placeholders[i] = "?"
			args[i] = id
		}

		query := fmt.Sprintf(`DELETE FROM resources WHERE id IN (%s)`, strings.Join(placeholders, ","))
		if _, err := tx.Exec(query, args...); err != nil {
			return fmt.Errorf("delete migrated records: %w", err)
		}
	}

	if migratedCount > 0 {
		fmt.Printf("Migrated %d audit records to resource_audit table\n", migratedCount)
	}

	return nil
}

// parseAuditRecord extracts resource ID and metadata from a legacy audit record.
// Legacy format: "<type>_audit/<resource_id>/<timestamp>"
// Returns resourceID, versionHash, tag (versionHash and tag are extracted from proto if possible)
func parseAuditRecord(id string, data []byte) (resourceID, versionHash, tag string) {
	// Split the ID to extract components
	// Example: "skill_audit/abc-123/1706123456789"
	parts := strings.Split(id, "/")
	if len(parts) < 2 {
		return "", "", ""
	}

	// The resource ID is the second part (after "skill_audit")
	resourceID = parts[1]

	// Note: We cannot easily extract versionHash and tag from the proto data
	// without knowing the specific proto type. These fields will be populated
	// by the controller when creating new audit records. For migrated records,
	// they remain empty and can be backfilled later if needed.
	//
	// The audit queries will still work - they just won't find migrated records
	// by hash/tag. The full proto data is preserved for manual inspection.

	return resourceID, "", ""
}

// SaveResource persists a proto message to the store.
// Uses INSERT OR REPLACE for upsert semantics.
func (s *Store) SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	// Marshal proto to bytes
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal proto: %w", err)
	}

	// INSERT OR REPLACE provides upsert semantics
	_, err = s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`,
		kind.String(), id, data)
	if err != nil {
		return fmt.Errorf("save resource: %w", err)
	}

	return nil
}

// UpdateResource atomically reads a resource, applies a caller-supplied
// modification, and persists the result. The entire read-modify-write is
// serialized under writeMu so concurrent updates to the same resource cannot
// overwrite each other.
func (s *Store) UpdateResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message, modify func() error) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	// Read
	var data []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT data FROM resources WHERE kind = ? AND id = ?`,
		kind.String(), id).Scan(&data)

	if err == sql.ErrNoRows {
		return fmt.Errorf("%w: %s/%s", store.ErrNotFound, kind.String(), id)
	}
	if err != nil {
		return fmt.Errorf("read resource for update: %w", err)
	}

	if err := proto.Unmarshal(data, msg); err != nil {
		return fmt.Errorf("unmarshal proto for update: %w", err)
	}

	// Modify (caller mutates msg in place)
	if err := modify(); err != nil {
		return err
	}

	// Write
	data, err = proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal proto after update: %w", err)
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`,
		kind.String(), id, data)
	if err != nil {
		return fmt.Errorf("save resource after update: %w", err)
	}

	return nil
}

// GetResource retrieves a resource by kind and ID.
// Returns store.ErrNotFound if the resource does not exist.
func (s *Store) GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	var data []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT data FROM resources WHERE kind = ? AND id = ?`,
		kind.String(), id).Scan(&data)

	if err == sql.ErrNoRows {
		return fmt.Errorf("%w: %s/%s", store.ErrNotFound, kind.String(), id)
	}
	if err != nil {
		return fmt.Errorf("query resource: %w", err)
	}

	// Unmarshal proto bytes into the provided message
	if err := proto.Unmarshal(data, msg); err != nil {
		return fmt.Errorf("unmarshal proto: %w", err)
	}

	return nil
}

// ListResources retrieves all resources of a given kind.
// Returns an empty slice (not nil) if no resources exist.
func (s *Store) ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT data FROM resources WHERE kind = ?`,
		kind.String())
	if err != nil {
		return nil, fmt.Errorf("query resources: %w", err)
	}
	defer rows.Close()

	// Pre-allocate slice to avoid reallocations
	results := make([][]byte, 0)

	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		// Copy data since database driver may reuse the buffer
		dataCopy := make([]byte, len(data))
		copy(dataCopy, data)
		results = append(results, dataCopy)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return results, nil
}

// DeleteResource removes a resource by kind and ID.
// Returns nil (no error) if the resource does not exist.
func (s *Store) DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	_, err := s.db.ExecContext(ctx,
		`DELETE FROM resources WHERE kind = ? AND id = ?`,
		kind.String(), id)
	if err != nil {
		return fmt.Errorf("delete resource: %w", err)
	}

	return nil
}

// DeleteResourcesByKind removes all resources of a given kind.
// Returns the number of resources deleted.
func (s *Store) DeleteResourcesByKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int64, error) {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	result, err := s.db.ExecContext(ctx,
		`DELETE FROM resources WHERE kind = ?`,
		kind.String())
	if err != nil {
		return 0, fmt.Errorf("delete resources by kind: %w", err)
	}

	return result.RowsAffected()
}

// DeleteResourcesByIdPrefix removes all resources of a given kind whose ID
// starts with the specified prefix.
// Uses GLOB for efficient prefix matching that utilizes the index.
//
// Deprecated: This method exists for backward compatibility with legacy prefix-based
// key patterns. New code should use the audit-specific methods instead.
func (s *Store) DeleteResourcesByIdPrefix(ctx context.Context, kind apiresourcekind.ApiResourceKind, idPrefix string) (int64, error) {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	// GLOB 'prefix*' is more efficient than LIKE 'prefix%' for prefix matching
	// because it uses the index when the prefix is a constant
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM resources WHERE kind = ? AND id GLOB ?`,
		kind.String(), idPrefix+"*")
	if err != nil {
		return 0, fmt.Errorf("delete resources by prefix: %w", err)
	}

	return result.RowsAffected()
}

// =============================================================================
// Field-Based Queries
// =============================================================================

// FindByField retrieves a single resource by matching a specific field value.
// The fieldPath uses dot notation (e.g., "spec.executionId") and the matcher
// function extracts the field value from the proto message for comparison.
//
// Since protobuf data is stored as binary BLOBs (not JSON), this implementation
// loads all resources of the given kind and filters in Go. For performance-critical
// queries, consider adding a dedicated database column with an index.
//
// Returns store.ErrNotFound if no resource matches.
func (s *Store) FindByField(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string, msg proto.Message) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	// Load all resources of this kind
	rows, err := s.db.QueryContext(ctx,
		`SELECT data FROM resources WHERE kind = ?`,
		kind.String())
	if err != nil {
		return fmt.Errorf("query resources: %w", err)
	}
	defer rows.Close()

	// Iterate and find matching resource
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}

		// Create a new instance of the message type for comparison
		testMsg := proto.Clone(msg)
		proto.Reset(testMsg)

		if err := proto.Unmarshal(data, testMsg); err != nil {
			// Skip malformed records
			continue
		}

		// Extract field value using protobuf reflection
		fieldValue := extractFieldValue(testMsg, fieldPath)
		if fieldValue == value {
			// Found a match - unmarshal into the output message
			if err := proto.Unmarshal(data, msg); err != nil {
				return fmt.Errorf("unmarshal proto: %w", err)
			}
			return nil
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate rows: %w", err)
	}

	return fmt.Errorf("%w: %s where %s=%s", store.ErrNotFound, kind.String(), fieldPath, value)
}

// FindAllByField retrieves all resources matching a specific field value.
// The fieldPath uses dot notation (e.g., "spec.workflowInstanceId").
//
// Since protobuf data is stored as binary BLOBs (not JSON), this implementation
// loads all resources of the given kind and filters in Go.
//
// Returns an empty slice (not nil) if no resources match.
func (s *Store) FindAllByField(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string) ([][]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	// Load all resources of this kind
	rows, err := s.db.QueryContext(ctx,
		`SELECT data FROM resources WHERE kind = ?`,
		kind.String())
	if err != nil {
		return nil, fmt.Errorf("query resources: %w", err)
	}
	defer rows.Close()

	results := make([][]byte, 0)

	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}

		// Copy data since database driver may reuse the buffer
		dataCopy := make([]byte, len(data))
		copy(dataCopy, data)

		// We need a proto type to unmarshal into for field extraction
		// Since we don't have the type here, we use protojson to convert to JSON
		// and then extract the field using JSON path
		// This is a workaround - callers should use the typed version when possible
		results = append(results, dataCopy)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	// Note: This returns ALL resources of the kind, not filtered.
	// The filtering needs to be done by the caller with the proto type.
	// This is because we can't unmarshal without knowing the proto type.
	return results, nil
}

// =============================================================================
// Label-Based Queries
// =============================================================================

// FindAllByLabel retrieves all resources matching a metadata label key-value pair.
// All API resources have metadata.labels (map<string, string>); this method uses
// proto reflection to access the map without needing the concrete message type.
// Returns an empty slice (not nil) if no resources match.
func (s *Store) FindAllByLabel(ctx context.Context, kind apiresourcekind.ApiResourceKind, labelKey, labelValue string, templateMsg proto.Message) ([][]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT data FROM resources WHERE kind = ?`,
		kind.String())
	if err != nil {
		return nil, fmt.Errorf("query resources: %w", err)
	}
	defer rows.Close()

	results := make([][]byte, 0)

	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}

		if matchesLabel(data, templateMsg, labelKey, labelValue) {
			dataCopy := make([]byte, len(data))
			copy(dataCopy, data)
			results = append(results, dataCopy)
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return results, nil
}

// extractLabelValue reads a single label value from metadata.labels using proto reflection.
// Returns "" if the metadata field, labels map, or the specific key is not present.
// Works for any API resource that has the standard metadata.labels field.
func extractLabelValue(msg proto.Message, labelKey string) string {
	ref := msg.ProtoReflect()

	metadataFd := ref.Descriptor().Fields().ByName("metadata")
	if metadataFd == nil || metadataFd.Kind() != protoreflect.MessageKind {
		return ""
	}
	metadata := ref.Get(metadataFd).Message()

	labelsFd := metadata.Descriptor().Fields().ByName("labels")
	if labelsFd == nil || !labelsFd.IsMap() {
		return ""
	}

	labelsMap := metadata.Get(labelsFd).Map()
	val := labelsMap.Get(protoreflect.ValueOfString(labelKey).MapKey())
	if !val.IsValid() {
		return ""
	}
	return val.String()
}

// matchesLabel unmarshals raw proto bytes into a clone of templateMsg and checks
// whether the resource's metadata.labels contains the given key-value pair.
func matchesLabel(data []byte, templateMsg proto.Message, labelKey, labelValue string) bool {
	testMsg := proto.Clone(templateMsg)
	proto.Reset(testMsg)

	if err := proto.Unmarshal(data, testMsg); err != nil {
		return false
	}
	return extractLabelValue(testMsg, labelKey) == labelValue
}

// =============================================================================
// Field Value Extraction Helpers
// =============================================================================

// extractFieldValue extracts a field value from a proto message using dot notation path.
// Example: extractFieldValue(msg, "spec.executionId") extracts the executionId from spec.
func extractFieldValue(msg proto.Message, fieldPath string) string {
	parts := strings.Split(fieldPath, ".")

	// Use protobuf reflection to navigate the field path
	current := msg.ProtoReflect()

	for i, part := range parts {
		// Find the field by name
		fields := current.Descriptor().Fields()
		field := fields.ByName(protoreflect.Name(part))
		if field == nil {
			// Try camelCase to snake_case conversion
			field = fields.ByName(protoreflect.Name(toSnakeCase(part)))
		}
		if field == nil {
			return ""
		}

		if i == len(parts)-1 {
			// Last part - get the value
			val := current.Get(field)
			return val.String()
		}

		// Not the last part - navigate into the nested message
		if field.Kind() != protoreflect.MessageKind {
			return ""
		}
		current = current.Get(field).Message()
	}

	return ""
}

// toSnakeCase converts a camelCase string to snake_case.
// Example: "executionId" -> "execution_id"
func toSnakeCase(s string) string {
	var result strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result.WriteByte('_')
		}
		result.WriteRune(r)
	}
	return strings.ToLower(result.String())
}

// =============================================================================
// Audit Operations
// =============================================================================

// SaveAudit archives an immutable snapshot of a resource for version history.
// Each call creates a new audit record with a unique auto-incremented ID.
func (s *Store) SaveAudit(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, msg proto.Message, versionHash, tag string) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	// Marshal proto to bytes
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal proto: %w", err)
	}

	// Insert new audit record
	// Auto-increment ID ensures uniqueness, archived_at defaults to now()
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO resource_audit (kind, resource_id, data, version_hash, tag, archived_at) 
		 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
		kind.String(), resourceId, data, versionHash, tag)
	if err != nil {
		return fmt.Errorf("save audit record: %w", err)
	}

	return nil
}

// GetAuditByHash retrieves an archived version by exact hash match.
// Returns store.ErrAuditNotFound if no audit record exists with the given hash.
//
// Thin adapter over GetAuditRecordByHash: it unmarshals the snapshot into msg.
// Callers that also need the version's current tag should use the record-based
// method directly (the tag column, not the embedded snapshot, is authoritative).
func (s *Store) GetAuditByHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, versionHash string, msg proto.Message) error {
	rec, err := s.GetAuditRecordByHash(ctx, kind, resourceId, versionHash)
	if err != nil {
		return err
	}
	if err := proto.Unmarshal(rec.Data, msg); err != nil {
		return fmt.Errorf("unmarshal proto: %w", err)
	}
	return nil
}

// GetAuditByTag retrieves the most recent archived version with matching tag.
// Returns store.ErrAuditNotFound if no audit record exists with the given tag.
//
// Thin adapter over GetAuditRecordByTag (see that method for the single-holder
// invariant and tiebreaker semantics).
func (s *Store) GetAuditByTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, tag string, msg proto.Message) error {
	rec, err := s.GetAuditRecordByTag(ctx, kind, resourceId, tag)
	if err != nil {
		return err
	}
	if err := proto.Unmarshal(rec.Data, msg); err != nil {
		return fmt.Errorf("unmarshal proto: %w", err)
	}
	return nil
}

// ListAuditHistory retrieves all archived versions for a resource.
// Returns newest first (sorted by archived_at DESC).
// Returns an empty slice (not nil) if no audit records exist.
//
// Thin adapter over ListAuditRecords, returning only the serialized snapshots.
func (s *Store) ListAuditHistory(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) ([][]byte, error) {
	records, err := s.ListAuditRecords(ctx, kind, resourceId)
	if err != nil {
		return nil, err
	}

	results := make([][]byte, 0, len(records))
	for _, rec := range records {
		results = append(results, rec.Data)
	}
	return results, nil
}

// DeleteAuditByResourceId removes all audit records for a resource.
// Returns the number of audit records deleted.
func (s *Store) DeleteAuditByResourceId(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) (int64, error) {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	result, err := s.db.ExecContext(ctx,
		`DELETE FROM resource_audit WHERE kind = ? AND resource_id = ?`,
		kind.String(), resourceId)
	if err != nil {
		return 0, fmt.Errorf("delete audit records: %w", err)
	}

	return result.RowsAffected()
}

// CountAuditEntries returns the number of audit records for a resource.
// Returns 0 (not an error) when no audit records exist.
func (s *Store) CountAuditEntries(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	var count int
	// Query uses idx_audit_resource index
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM resource_audit 
		 WHERE kind = ? AND resource_id = ?`,
		kind.String(), resourceId).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count audit entries: %w", err)
	}

	return count, nil
}

// GetLatestAuditHash returns the version hash of the most recent audit record
// for a resource. Returns store.ErrAuditNotFound if no audit record exists.
func (s *Store) GetLatestAuditHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return "", fmt.Errorf("store is closed")
	}

	var versionHash string
	// Query uses idx_audit_resource index and returns most recent by archived_at
	// Use id DESC as tiebreaker when timestamps are equal (sub-second inserts)
	err := s.db.QueryRowContext(ctx,
		`SELECT version_hash FROM resource_audit 
		 WHERE kind = ? AND resource_id = ?
		 ORDER BY archived_at DESC, id DESC
		 LIMIT 1`,
		kind.String(), resourceId).Scan(&versionHash)

	if err == sql.ErrNoRows {
		return "", fmt.Errorf("%w: %s/%s", store.ErrAuditNotFound, kind.String(), resourceId)
	}
	if err != nil {
		return "", fmt.Errorf("query latest audit hash: %w", err)
	}

	return versionHash, nil
}

// SetAuditTag moves a tag to a specific archived version, atomically.
//
// The tag column is the source of truth for a version's tag (never the embedded
// snapshot blob, which stays immutable). To enforce "a tag names exactly one
// version," the two UPDATEs run in a single transaction: first clear the tag
// from its prior holder(s), then assign it to the target. If the target hash
// has no audit record, the transaction is rolled back and ErrAuditNotFound is
// returned — a missing target never orphans the tag on its prior holder.
func (s *Store) SetAuditTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, versionHash, tag string) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin set audit tag transaction: %w", err)
	}
	defer tx.Rollback()

	// Clear the tag from whatever version currently holds it. Restricting to a
	// non-empty tag never disturbs untagged rows (stored as '').
	if _, err := tx.ExecContext(ctx,
		`UPDATE resource_audit SET tag = ''
		 WHERE kind = ? AND resource_id = ? AND tag = ?`,
		kind.String(), resourceId, tag); err != nil {
		return fmt.Errorf("clear prior tag holder: %w", err)
	}

	// Assign the tag to the target version (replacing any different tag it held).
	res, err := tx.ExecContext(ctx,
		`UPDATE resource_audit SET tag = ?
		 WHERE kind = ? AND resource_id = ? AND version_hash = ?`,
		tag, kind.String(), resourceId, versionHash)
	if err != nil {
		return fmt.Errorf("assign tag to version: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if affected == 0 {
		// Rollback (deferred) leaves the prior holder untouched.
		return fmt.Errorf("%w: %s/%s (hash=%s)", store.ErrAuditNotFound, kind.String(), resourceId, versionHash)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit set audit tag: %w", err)
	}

	return nil
}

// ListAuditRecords retrieves all archived versions for a resource, newest first,
// each carrying its authoritative tag from the tag column.
func (s *Store) ListAuditRecords(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) ([]store.AuditRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	// Use id DESC as tiebreaker when timestamps are equal (sub-second inserts)
	rows, err := s.db.QueryContext(ctx,
		`SELECT data, version_hash, tag FROM resource_audit
		 WHERE kind = ? AND resource_id = ?
		 ORDER BY archived_at DESC, id DESC`,
		kind.String(), resourceId)
	if err != nil {
		return nil, fmt.Errorf("query audit records: %w", err)
	}
	defer rows.Close()

	records := make([]store.AuditRecord, 0)
	for rows.Next() {
		var (
			data        []byte
			versionHash sql.NullString
			tag         sql.NullString
		)
		if err := rows.Scan(&data, &versionHash, &tag); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		// Copy data since the driver may reuse the buffer across iterations.
		dataCopy := make([]byte, len(data))
		copy(dataCopy, data)
		records = append(records, store.AuditRecord{
			Data:        dataCopy,
			VersionHash: versionHash.String,
			Tag:         tag.String,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return records, nil
}

// GetAuditRecordByHash retrieves a single archived version by exact hash,
// carrying its authoritative tag from the tag column.
func (s *Store) GetAuditRecordByHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, versionHash string) (*store.AuditRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	var (
		data []byte
		tag  sql.NullString
	)
	// Query uses idx_audit_hash index for efficient lookup
	err := s.db.QueryRowContext(ctx,
		`SELECT data, tag FROM resource_audit
		 WHERE kind = ? AND resource_id = ? AND version_hash = ?
		 LIMIT 1`,
		kind.String(), resourceId, versionHash).Scan(&data, &tag)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("%w: %s/%s (hash=%s)", store.ErrAuditNotFound, kind.String(), resourceId, versionHash)
	}
	if err != nil {
		return nil, fmt.Errorf("query audit record by hash: %w", err)
	}

	return &store.AuditRecord{Data: data, VersionHash: versionHash, Tag: tag.String}, nil
}

// GetAuditRecordByTag retrieves the archived version currently holding the given
// tag, carrying its authoritative tag from the tag column. The single-holder
// invariant means at most one row matches; ORDER BY archived_at DESC is a
// defensive tiebreaker for any legacy multi-holder data.
func (s *Store) GetAuditRecordByTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, tag string) (*store.AuditRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	var (
		data        []byte
		versionHash sql.NullString
	)
	// Query uses idx_audit_tag index and returns most recent by archived_at.
	// Use id DESC as tiebreaker when timestamps are equal (sub-second inserts).
	err := s.db.QueryRowContext(ctx,
		`SELECT data, version_hash FROM resource_audit
		 WHERE kind = ? AND resource_id = ? AND tag = ?
		 ORDER BY archived_at DESC, id DESC
		 LIMIT 1`,
		kind.String(), resourceId, tag).Scan(&data, &versionHash)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("%w: %s/%s (tag=%s)", store.ErrAuditNotFound, kind.String(), resourceId, tag)
	}
	if err != nil {
		return nil, fmt.Errorf("query audit record by tag: %w", err)
	}

	return &store.AuditRecord{Data: data, VersionHash: versionHash.String, Tag: tag}, nil
}

// =============================================================================
// Search Index Operations (Full-Text Search)
// =============================================================================

// UpsertSearchIndex inserts or updates a search index entry for a resource.
// This uses FTS5's INSERT OR REPLACE semantics via a DELETE + INSERT pattern
// since FTS5 doesn't support UPDATE directly.
//
// The entry's fields are indexed for full-text search:
//   - name: highest weight in BM25 ranking
//   - description: medium weight
//   - tags: medium weight (space-separated)
//
// Non-searchable fields (org, visibility, created_at) are stored for filtering and sorting.
func (s *Store) UpsertSearchIndex(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, entry *store.SearchIndexEntry) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	// FTS5 doesn't support UPDATE, so we DELETE + INSERT
	// This is wrapped in a transaction for atomicity
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Delete existing entry (if any)
	_, err = tx.ExecContext(ctx,
		`DELETE FROM search_index WHERE kind = ? AND resource_id = ?`,
		kind.String(), resourceId)
	if err != nil {
		return fmt.Errorf("delete existing search index entry: %w", err)
	}

	// Insert new entry
	_, err = tx.ExecContext(ctx,
		`INSERT INTO search_index (kind, resource_id, name, description, tags, org, visibility, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		kind.String(),
		resourceId,
		entry.Name,
		entry.Description,
		entry.Tags,
		entry.Org,
		entry.Visibility,
		entry.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert search index entry: %w", err)
	}

	return tx.Commit()
}

// DeleteSearchIndex removes a search index entry for a resource.
// Should be called when a resource is deleted.
func (s *Store) DeleteSearchIndex(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	_, err := s.db.ExecContext(ctx,
		`DELETE FROM search_index WHERE kind = ? AND resource_id = ?`,
		kind.String(), resourceId)
	if err != nil {
		return fmt.Errorf("delete search index entry: %w", err)
	}

	return nil
}

// =============================================================================
// Bootstrap State Operations
// =============================================================================

// GetBootstrapState retrieves a bootstrap state value by key.
// Returns an empty string if the key does not exist.
//
// Common keys:
//   - "seedpack_version": Version of the seedpack currently applied
//   - "bootstrap_status": Overall status (pending, in_progress, completed, failed)
//   - "skill:<name>": State of a skill (e.g., "applied:sha256:...")
//   - "agent:<name>": State of an agent (e.g., "applied:sha256:...")
func (s *Store) GetBootstrapState(ctx context.Context, key string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return "", fmt.Errorf("store is closed")
	}

	var value string
	err := s.db.QueryRowContext(ctx,
		`SELECT value FROM bootstrap_state WHERE key = ?`,
		key).Scan(&value)

	if err == sql.ErrNoRows {
		return "", nil // Key not found, return empty string (not an error)
	}
	if err != nil {
		return "", fmt.Errorf("query bootstrap state: %w", err)
	}

	return value, nil
}

// SetBootstrapState stores or updates a bootstrap state value.
// Uses INSERT OR REPLACE for upsert semantics.
func (s *Store) SetBootstrapState(ctx context.Context, key, value string) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	_, err := s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO bootstrap_state (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
		key, value)
	if err != nil {
		return fmt.Errorf("set bootstrap state: %w", err)
	}

	return nil
}

// GetAllBootstrapState retrieves all bootstrap state key-value pairs.
// Returns an empty map if no state exists.
func (s *Store) GetAllBootstrapState(ctx context.Context) (map[string]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM bootstrap_state`)
	if err != nil {
		return nil, fmt.Errorf("query all bootstrap state: %w", err)
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

// DeleteBootstrapState removes a bootstrap state entry.
// Returns nil (no error) if the key does not exist.
func (s *Store) DeleteBootstrapState(ctx context.Context, key string) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	_, err := s.db.ExecContext(ctx,
		`DELETE FROM bootstrap_state WHERE key = ?`,
		key)
	if err != nil {
		return fmt.Errorf("delete bootstrap state: %w", err)
	}

	return nil
}

// ClearBootstrapState removes all bootstrap state entries.
// This is useful for testing or forcing a re-bootstrap.
func (s *Store) ClearBootstrapState(ctx context.Context) error {
	// Acquire write lock to serialize writes (SQLite single-writer limitation)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	_, err := s.db.ExecContext(ctx, `DELETE FROM bootstrap_state`)
	if err != nil {
		return fmt.Errorf("clear bootstrap state: %w", err)
	}

	return nil
}

// =============================================================================
// Workflow Execution Event Operations
// =============================================================================

// AppendWorkflowExecutionEvents appends events to the execution's event log.
//
// Insert-or-skip, first-writer-wins: `INSERT OR IGNORE` on the
// (execution_id, sequence_number) primary key silently skips
// already-persisted sequences while the rest of the batch lands. Sequence
// numbers are assigned deterministically in the runner's workflow sandbox,
// so a retried batch re-sends the same numbers (idempotent no-op) and
// parallel branches may deliver out of order (a lower sequence arriving
// after a higher one is still valid, not stale). This replaces the old
// all-or-nothing stale-sequence rejection that silently dropped whole
// batches on retry (oss#308), and matches the cloud edition's
// `ON CONFLICT DO NOTHING` contract.
//
// Returns the number of events actually inserted.
func (s *Store) AppendWorkflowExecutionEvents(ctx context.Context, executionID string, events []*store.WorkflowExecutionEventRecord) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT OR IGNORE INTO workflow_execution_events (execution_id, sequence_number, event_type, task_name, data)
		 VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	inserted := 0
	for _, evt := range events {
		res, err := stmt.ExecContext(ctx, executionID, evt.SequenceNumber, evt.EventType, evt.TaskName, evt.Data)
		if err != nil {
			return 0, fmt.Errorf("insert event seq=%d: %w", evt.SequenceNumber, err)
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("rows affected for event seq=%d: %w", evt.SequenceNumber, err)
		}
		inserted += int(rows)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}

	return inserted, nil
}

// GetWorkflowExecutionEvents retrieves events for an execution with cursor-based pagination.
func (s *Store) GetWorkflowExecutionEvents(ctx context.Context, executionID string, afterSequence int64, eventType string, taskName string, limit int) ([]*store.WorkflowExecutionEventRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	if limit <= 0 {
		limit = 100
	}

	query := `SELECT execution_id, sequence_number, event_type, task_name, data, created_at
		FROM workflow_execution_events
		WHERE execution_id = ? AND sequence_number > ?`
	args := []interface{}{executionID, afterSequence}

	if eventType != "" {
		query += ` AND event_type = ?`
		args = append(args, eventType)
	}
	if taskName != "" {
		query += ` AND task_name = ?`
		args = append(args, taskName)
	}

	query += ` ORDER BY sequence_number ASC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	results := make([]*store.WorkflowExecutionEventRecord, 0)
	for rows.Next() {
		rec := &store.WorkflowExecutionEventRecord{}
		if err := rows.Scan(&rec.ExecutionID, &rec.SequenceNumber, &rec.EventType, &rec.TaskName, &rec.Data, &rec.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		results = append(results, rec)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return results, nil
}

// GetMaxEventSequence returns the highest sequence_number for an execution.
// Returns 0 if no events exist.
func (s *Store) GetMaxEventSequence(ctx context.Context, executionID string) (int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	var maxSeq int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(sequence_number), 0) FROM workflow_execution_events WHERE execution_id = ?`,
		executionID).Scan(&maxSeq)
	if err != nil {
		return 0, fmt.Errorf("query max event sequence: %w", err)
	}

	return maxSeq, nil
}

// =============================================================================
// Schedule Run Operations (Fire Ledger)
// =============================================================================

// UpsertScheduleRun inserts or updates the fire's ledger row, keyed on
// (schedule_id, nominal_fire_time, origin). The ON CONFLICT arm carries
// the terminal-immutability guard: a row whose completed_at is already
// set is never downgraded, so a replayed "started" write after the
// verdict landed is a no-op by construction.
func (s *Store) UpsertScheduleRun(ctx context.Context, record *store.ScheduleRunRecord) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	recordedAt := record.RecordedAt
	if recordedAt == "" {
		recordedAt = time.Now().UTC().Format(time.RFC3339)
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO schedule_runs
			(schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (schedule_id, nominal_fire_time, origin) DO UPDATE SET
			outcome = excluded.outcome,
			reason = excluded.reason,
			execution_id = excluded.execution_id,
			completed_at = excluded.completed_at
		WHERE schedule_runs.completed_at = ''`,
		record.ScheduleID, record.Org, record.NominalFireTime, record.Origin,
		record.Outcome, record.Reason, record.ExecutionID, recordedAt, record.CompletedAt)
	if err != nil {
		return fmt.Errorf("upsert schedule run %s/%s/%s: %w",
			record.ScheduleID, record.NominalFireTime, record.Origin, err)
	}
	return nil
}

// MarkLatestScheduleRunTerminal stamps the terminal verdict on the
// schedule's newest non-terminal row of the given origin (see the
// interface doc for why the key is (schedule, origin)). No matching row
// is a silent no-op.
func (s *Store) MarkLatestScheduleRunTerminal(ctx context.Context, scheduleID, origin, outcome, reason, completedAt string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	_, err := s.db.ExecContext(ctx, `
		UPDATE schedule_runs SET outcome = ?, reason = ?, completed_at = ?
		WHERE schedule_id = ? AND origin = ? AND completed_at = ''
		AND nominal_fire_time = (
			SELECT MAX(nominal_fire_time) FROM schedule_runs
			WHERE schedule_id = ? AND origin = ? AND completed_at = ''
		)`,
		outcome, reason, completedAt, scheduleID, origin, scheduleID, origin)
	if err != nil {
		return fmt.Errorf("mark schedule run terminal for %s: %w", scheduleID, err)
	}
	return nil
}

// ListScheduleRuns returns the schedule's recorded fires, newest first,
// plus the total count for pagination.
func (s *Store) ListScheduleRuns(ctx context.Context, scheduleID string, offset, limit int) ([]*store.ScheduleRunRecord, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, 0, fmt.Errorf("store is closed")
	}

	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM schedule_runs WHERE schedule_id = ?`, scheduleID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count schedule runs for %s: %w", scheduleID, err)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT schedule_id, org, nominal_fire_time, origin, outcome, reason, execution_id, recorded_at, completed_at
		FROM schedule_runs
		WHERE schedule_id = ?
		ORDER BY nominal_fire_time DESC, origin DESC
		LIMIT ? OFFSET ?`,
		scheduleID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query schedule runs for %s: %w", scheduleID, err)
	}
	defer rows.Close()

	results := make([]*store.ScheduleRunRecord, 0)
	for rows.Next() {
		rec := &store.ScheduleRunRecord{}
		if err := rows.Scan(&rec.ScheduleID, &rec.Org, &rec.NominalFireTime, &rec.Origin,
			&rec.Outcome, &rec.Reason, &rec.ExecutionID, &rec.RecordedAt, &rec.CompletedAt); err != nil {
			return nil, 0, fmt.Errorf("scan schedule run: %w", err)
		}
		results = append(results, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate schedule runs: %w", err)
	}
	return results, total, nil
}

// DeleteScheduleRunsBySchedule removes every ledger row of one schedule.
func (s *Store) DeleteScheduleRunsBySchedule(ctx context.Context, scheduleID string) (int64, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	result, err := s.db.ExecContext(ctx,
		`DELETE FROM schedule_runs WHERE schedule_id = ?`, scheduleID)
	if err != nil {
		return 0, fmt.Errorf("delete schedule runs for %s: %w", scheduleID, err)
	}
	return result.RowsAffected()
}

// PruneScheduleRuns removes ledger rows recorded before the cutoff — the
// retention policy the table was born with (project DD-017 D-7).
func (s *Store) PruneScheduleRuns(ctx context.Context, recordedBefore string) (int64, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return 0, fmt.Errorf("store is closed")
	}

	result, err := s.db.ExecContext(ctx,
		`DELETE FROM schedule_runs WHERE recorded_at < ?`, recordedBefore)
	if err != nil {
		return 0, fmt.Errorf("prune schedule runs before %s: %w", recordedBefore, err)
	}
	return result.RowsAffected()
}

// Close releases all resources held by the store.
// After Close is called, all other methods will return errors.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil // Already closed
	}

	err := s.db.Close()
	s.db = nil

	if err != nil {
		return fmt.Errorf("close database: %w", err)
	}

	return nil
}

// Path returns the filesystem path to the SQLite database file.
// This is useful for debugging and external tooling access.
func (s *Store) Path() string {
	return s.path
}

// DB returns the underlying *sql.DB connection.
// This is useful for components that need direct database access,
// such as the SearchQueryStore that needs to query the FTS5 index.
//
// Warning: Be careful when using direct database access - ensure proper
// locking if performing writes. Prefer using the Store methods for
// standard operations.
func (s *Store) DB() *sql.DB {
	return s.db
}
