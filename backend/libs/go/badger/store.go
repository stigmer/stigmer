// Package badger provides a generic resource storage layer using BadgerDB with Protobuf documents.
// This implements the "Single Bucket" pattern from ADR-005 (Revised) using BadgerDB instead of SQLite.
package badger

import (
	"context"
	"fmt"
	"time"

	"github.com/dgraph-io/badger/v4"
	"google.golang.org/protobuf/proto"
)

// Store manages BadgerDB database connections and operations
type Store struct {
	db *badger.DB
}

// Resource represents the metadata and payload stored in BadgerDB.
// Note: OrgID and ProjectID are intentionally excluded (cloud-specific fields not needed locally).
type Resource struct {
	ID        string
	Kind      string
	Data      []byte    // The marshaled Protobuf message
	UpdatedAt time.Time
}

// NewStore creates a new BadgerDB store at the given path
func NewStore(dbPath string) (*Store, error) {
	// Configure BadgerDB options
	opts := badger.DefaultOptions(dbPath)
	opts.Logger = nil // Disable BadgerDB's verbose logging

	db, err := badger.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to open badger database: %w", err)
	}

	store := &Store{db: db}
	return store, nil
}

// SaveResource writes the proto message to the DB.
// It relies on the caller to provide the correct Kind and ID.
// It stores the raw proto bytes directly.
func (s *Store) SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error {
	// 1. Marshal the proto payload
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	// 2. Construct Key: "Kind/ID"
	key := []byte(fmt.Sprintf("%s/%s", kind, id))

	// 3. Write to DB
	return s.db.Update(func(txn *badger.Txn) error {
		return txn.Set(key, data)
	})
}

// GetResource retrieves a generic proto message by Kind and ID.
// The caller MUST provide an initialized proto message pointer (msg) of the correct type.
func (s *Store) GetResource(ctx context.Context, kind string, id string, msg proto.Message) error {
	key := []byte(fmt.Sprintf("%s/%s", kind, id))

	return s.db.View(func(txn *badger.Txn) error {
		item, err := txn.Get(key)
		if err == badger.ErrKeyNotFound {
			return fmt.Errorf("resource not found: %s/%s", kind, id)
		}
		if err != nil {
			return err
		}

		// Zero-copy unmarshal if possible
		return item.Value(func(val []byte) error {
			return proto.Unmarshal(val, msg)
		})
	})
}

// ListResources returns all resources for a specific Kind.
// It uses a Prefix Scan to simulate "GetCollection(Kind)".
func (s *Store) ListResources(ctx context.Context, kind string) ([][]byte, error) {
	prefix := []byte(kind + "/")
	var results [][]byte

	err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		// Seek to the start of the "Kind" bucket and iterate
		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			item := it.Item()
			err := item.Value(func(val []byte) error {
				// Must copy data because 'val' is reused by iterator
				data := make([]byte, len(val))
				copy(data, val)
				results = append(results, data)
				return nil
			})
			if err != nil {
				return err
			}
		}
		return nil
	})

	return results, err
}

// DeleteResource deletes a specific resource.
// Requires 'kind' to construct the key directly (O(1) operation).
func (s *Store) DeleteResource(ctx context.Context, kind string, id string) error {
	key := []byte(fmt.Sprintf("%s/%s", kind, id))
	return s.db.Update(func(txn *badger.Txn) error {
		return txn.Delete(key)
	})
}

// DeleteResourcesByKind wipes all data for a specific resource type.
// Useful for "stigmer local clean --kind=Agent"
// Returns the number of resources deleted.
func (s *Store) DeleteResourcesByKind(ctx context.Context, kind string) (int64, error) {
	prefix := []byte(kind + "/")
	
	// 1. Collect keys (Badger doesn't support range delete native in one go without collecting)
	var keys [][]byte
	err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()
		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			keys = append(keys, it.Item().KeyCopy(nil))
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	// 2. Batch Delete
	if len(keys) > 0 {
		err := s.db.Update(func(txn *badger.Txn) error {
			for _, k := range keys {
				if err := txn.Delete(k); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return 0, err
		}
	}
	return int64(len(keys)), nil
}

// Close closes the database connection
func (s *Store) Close() error {
	return s.db.Close()
}

