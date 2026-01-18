// Package badger provides a generic resource storage layer using BadgerDB with Protobuf documents.
// This implements the "Single Bucket" pattern from ADR-005 (Revised) using BadgerDB instead of SQLite.
package badger

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dgraph-io/badger/v4"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// Store manages BadgerDB database connections and operations
type Store struct {
	db *badger.DB
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

// SaveResource saves a proto message to BadgerDB
// Key format: kind/id
// Value: Protobuf bytes (not JSON for performance)
func (s *Store) SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error {
	// Marshal proto to bytes (binary format for efficiency)
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal proto: %w", err)
	}

	// Construct key: "kind/id"
	key := []byte(fmt.Sprintf("%s/%s", kind, id))

	// Write to database
	err = s.db.Update(func(txn *badger.Txn) error {
		return txn.Set(key, data)
	})

	if err != nil {
		return fmt.Errorf("failed to save resource: %w", err)
	}

	return nil
}

// GetResource retrieves a resource by ID and unmarshals into the provided proto message
func (s *Store) GetResource(ctx context.Context, id string, msg proto.Message) error {
	// First, we need to determine the kind from the message type
	kind := getKindFromMessage(msg)
	key := []byte(fmt.Sprintf("%s/%s", kind, id))

	var data []byte
	err := s.db.View(func(txn *badger.Txn) error {
		item, err := txn.Get(key)
		if err != nil {
			return err
		}

		// Get value
		return item.Value(func(val []byte) error {
			// Copy the value since it's only valid within the transaction
			data = append([]byte{}, val...)
			return nil
		})
	})

	if err == badger.ErrKeyNotFound {
		return fmt.Errorf("resource not found: %s", id)
	}
	if err != nil {
		return fmt.Errorf("failed to get resource: %w", err)
	}

	// Unmarshal proto
	if err := proto.Unmarshal(data, msg); err != nil {
		return fmt.Errorf("failed to unmarshal proto: %w", err)
	}

	return nil
}

// ListResources retrieves all resources of a given kind
// Uses prefix scan: "kind/" to find all resources of that kind
// Returns proto bytes which need to be unmarshaled by the caller
func (s *Store) ListResources(ctx context.Context, kind string) ([][]byte, error) {
	prefix := []byte(kind + "/")
	var results [][]byte

	err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			item := it.Item()
			err := item.Value(func(val []byte) error {
				// Copy value since it's only valid within transaction
				data := append([]byte{}, val...)
				results = append(results, data)
				return nil
			})
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	return results, nil
}

// ListResourcesByOrg retrieves all resources of a given kind for an organization
// This requires iterating through all resources and filtering by org_id
// TODO: This is not optimized (full scan). For now, returns all resources
// Caller must filter by org_id after unmarshaling
func (s *Store) ListResourcesByOrg(ctx context.Context, kind string, orgID string) ([][]byte, error) {
	prefix := []byte(kind + "/")
	var results [][]byte

	err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			item := it.Item()
			err := item.Value(func(val []byte) error {
				// Copy value since it's only valid within transaction
				data := append([]byte{}, val...)
				
				// TODO: Unmarshal and check org_id to filter
				// For now, return all (caller must filter)
				// This is acceptable for local usage with small datasets
				results = append(results, data)
				return nil
			})
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	return results, nil
}

// DeleteResource deletes a resource by ID
func (s *Store) DeleteResource(ctx context.Context, id string) error {
	// We need to find the key by scanning with id suffix
	// This is less efficient but works for local usage
	var keyToDelete []byte

	err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			key := item.Key()
			
			// Check if key ends with /id
			if strings.HasSuffix(string(key), "/"+id) {
				keyToDelete = append([]byte{}, key...)
				return nil
			}
		}
		return fmt.Errorf("resource not found: %s", id)
	})

	if err != nil {
		return err
	}

	// Delete the key
	err = s.db.Update(func(txn *badger.Txn) error {
		return txn.Delete(keyToDelete)
	})

	if err != nil {
		return fmt.Errorf("failed to delete resource: %w", err)
	}

	return nil
}

// DeleteResourcesByKind deletes all resources of a given kind
func (s *Store) DeleteResourcesByKind(ctx context.Context, kind string) (int64, error) {
	prefix := []byte(kind + "/")
	var keysToDelete [][]byte

	// Collect keys to delete
	err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			item := it.Item()
			key := append([]byte{}, item.Key()...)
			keysToDelete = append(keysToDelete, key)
		}
		return nil
	})

	if err != nil {
		return 0, fmt.Errorf("failed to collect keys: %w", err)
	}

	// Delete all collected keys
	count := int64(0)
	err = s.db.Update(func(txn *badger.Txn) error {
		for _, key := range keysToDelete {
			if err := txn.Delete(key); err != nil {
				return err
			}
			count++
		}
		return nil
	})

	if err != nil {
		return 0, fmt.Errorf("failed to delete resources: %w", err)
	}

	return count, nil
}

// Close closes the database connection
func (s *Store) Close() error {
	return s.db.Close()
}

// getKindFromMessage extracts the kind from a proto message
// This uses the message descriptor's full name
func getKindFromMessage(msg proto.Message) string {
	if msg == nil {
		return ""
	}

	// Get the message descriptor
	descriptor := msg.ProtoReflect().Descriptor()
	
	// Extract the simple name (e.g., "Agent" from "ai.stigmer.agentic.agent.v1.Agent")
	fullName := string(descriptor.FullName())
	parts := strings.Split(fullName, ".")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	
	return ""
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
