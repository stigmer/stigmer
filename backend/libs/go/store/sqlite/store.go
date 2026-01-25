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
	"sync"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"

	// Pure Go SQLite driver - no CGO required
	_ "modernc.org/sqlite"
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
		{"PRAGMA foreign_keys=OFF", "Not using foreign keys"},
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

// runMigrations creates the required schema if it doesn't exist.
// Future versions can add migration versioning if needed.
func runMigrations(db *sql.DB) error {
	// Single table document store - mirrors BadgerDB's key-value model
	// WITHOUT ROWID creates a clustered index on (kind, id) for optimal prefix scans
	schema := `
		CREATE TABLE IF NOT EXISTS resources (
			kind TEXT NOT NULL,
			id TEXT NOT NULL,
			data BLOB NOT NULL,
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (kind, id)
		) WITHOUT ROWID;

		-- Index optimizes prefix scans for DeleteResourcesByIdPrefix
		CREATE INDEX IF NOT EXISTS idx_resources_kind_id ON resources(kind, id);
	`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}

	return nil
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
