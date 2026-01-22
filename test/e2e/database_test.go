package e2e

import (
	"os"
	"path/filepath"
	"testing"

	badger "github.com/dgraph-io/badger/v3"
)

// TestDatabaseReadWrite tests that we can write to and read from BadgerDB
// This is a simpler test that doesn't involve the full apply workflow
func TestDatabaseReadWrite(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "stigmer-db-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	dbPath := filepath.Join(tempDir, "test.db")
	t.Logf("Using database at: %s", dbPath)

	// Open database for writing
	opts := badger.DefaultOptions(dbPath)
	opts.Logger = nil

	db, err := badger.Open(opts)
	if err != nil {
		t.Fatalf("Failed to open BadgerDB: %v", err)
	}

	// Write test data
	testKey := "test:agent:test-agent"
	testValue := []byte("test agent data")

	err = db.Update(func(txn *badger.Txn) error {
		return txn.Set([]byte(testKey), testValue)
	})
	if err != nil {
		db.Close()
		t.Fatalf("Failed to write to database: %v", err)
	}

	db.Close()
	t.Log("✓ Wrote test data to database")

	// Now read it back using our helper
	readValue, err := GetFromDB(dbPath, testKey)
	if err != nil {
		t.Fatalf("Failed to read from database: %v", err)
	}

	if string(readValue) != string(testValue) {
		t.Fatalf("Data mismatch: expected %s, got %s", testValue, readValue)
	}

	t.Log("✓ Successfully read data back from database")

	// Test ListKeysFromDB
	keys, err := ListKeysFromDB(dbPath, "test:")
	if err != nil {
		t.Fatalf("Failed to list keys: %v", err)
	}

	if len(keys) != 1 || keys[0] != testKey {
		t.Fatalf("Expected 1 key (%s), got: %v", testKey, keys)
	}

	t.Log("✓ Successfully listed keys from database")
	t.Log("✅ Database read/write test passed!")
}
