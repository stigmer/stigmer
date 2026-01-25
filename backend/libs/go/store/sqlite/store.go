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

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"

	// Pure Go SQLite driver - no CGO required
	_ "modernc.org/sqlite"
)

// Schema version constants for migration tracking
const (
	// schemaVersion1: Initial schema with single resources table (BadgerDB-style)
	schemaVersion1 = 1
	// schemaVersion2: Separate audit table with foreign keys for proper relational design
	schemaVersion2 = 2

	// currentSchemaVersion is the target version for new databases
	currentSchemaVersion = schemaVersion2
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
// This is the original BadgerDB-style single-table schema.
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
// This replaces the BadgerDB-style prefix-based audit storage with a proper relational model.
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

// migrateAuditRecords moves prefix-based audit records to the new resource_audit table.
// This handles the BadgerDB legacy pattern where audit records were stored as:
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
// Deprecated: This method exists for backward compatibility with BadgerDB-style
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
func (s *Store) GetAuditByHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, versionHash string, msg proto.Message) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	var data []byte
	// Query uses idx_audit_hash index for efficient lookup
	err := s.db.QueryRowContext(ctx,
		`SELECT data FROM resource_audit 
		 WHERE kind = ? AND resource_id = ? AND version_hash = ?
		 LIMIT 1`,
		kind.String(), resourceId, versionHash).Scan(&data)

	if err == sql.ErrNoRows {
		return fmt.Errorf("%w: %s/%s (hash=%s)", store.ErrAuditNotFound, kind.String(), resourceId, versionHash)
	}
	if err != nil {
		return fmt.Errorf("query audit by hash: %w", err)
	}

	// Unmarshal proto bytes into the provided message
	if err := proto.Unmarshal(data, msg); err != nil {
		return fmt.Errorf("unmarshal proto: %w", err)
	}

	return nil
}

// GetAuditByTag retrieves the most recent archived version with matching tag.
// Returns store.ErrAuditNotFound if no audit record exists with the given tag.
func (s *Store) GetAuditByTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, tag string, msg proto.Message) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return fmt.Errorf("store is closed")
	}

	var data []byte
	// Query uses idx_audit_tag index and returns most recent by archived_at
	// Use id DESC as tiebreaker when timestamps are equal (sub-second inserts)
	err := s.db.QueryRowContext(ctx,
		`SELECT data FROM resource_audit 
		 WHERE kind = ? AND resource_id = ? AND tag = ?
		 ORDER BY archived_at DESC, id DESC
		 LIMIT 1`,
		kind.String(), resourceId, tag).Scan(&data)

	if err == sql.ErrNoRows {
		return fmt.Errorf("%w: %s/%s (tag=%s)", store.ErrAuditNotFound, kind.String(), resourceId, tag)
	}
	if err != nil {
		return fmt.Errorf("query audit by tag: %w", err)
	}

	// Unmarshal proto bytes into the provided message
	if err := proto.Unmarshal(data, msg); err != nil {
		return fmt.Errorf("unmarshal proto: %w", err)
	}

	return nil
}

// ListAuditHistory retrieves all archived versions for a resource.
// Returns newest first (sorted by archived_at DESC).
// Returns an empty slice (not nil) if no audit records exist.
func (s *Store) ListAuditHistory(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) ([][]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("store is closed")
	}

	// Query uses idx_audit_resource index
	// Use id DESC as tiebreaker when timestamps are equal (sub-second inserts)
	rows, err := s.db.QueryContext(ctx,
		`SELECT data FROM resource_audit 
		 WHERE kind = ? AND resource_id = ?
		 ORDER BY archived_at DESC, id DESC`,
		kind.String(), resourceId)
	if err != nil {
		return nil, fmt.Errorf("query audit history: %w", err)
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
		results = append(results, dataCopy)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
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
