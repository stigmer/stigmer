package dedupe

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// =============================================================================
// Test Helpers
// =============================================================================

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()

	// Create a temporary database file
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("Failed to open test database: %v", err)
	}

	// Cleanup on test end
	t.Cleanup(func() {
		db.Close()
		os.Remove(dbPath)
	})

	return db
}

func setupTestStore(t *testing.T) *SQLiteSignalDedupeStore {
	t.Helper()

	db := setupTestDB(t)
	store, err := NewSQLiteSignalDedupeStore(db)
	if err != nil {
		t.Fatalf("Failed to create test store: %v", err)
	}

	return store
}

// =============================================================================
// Signal Dedupe Store Tests
// =============================================================================

func TestSignalDedupeStore_Claim(t *testing.T) {
	store := setupTestStore(t)
	ctx := context.Background()

	t.Run("claim new key succeeds", func(t *testing.T) {
		result, err := store.Claim(ctx, "org-1", "key-1", "wfx-1", "signal_1", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("Claim failed: %v", err)
		}

		if result.Status != ClaimStatusSuccess {
			t.Errorf("Expected ClaimStatusSuccess, got %v", result.Status)
		}

		if result.Record != nil {
			t.Errorf("Expected nil record for successful claim, got %+v", result.Record)
		}
	})

	t.Run("claim duplicate key returns duplicate", func(t *testing.T) {
		// First claim should succeed
		result1, err := store.Claim(ctx, "org-2", "key-2", "wfx-2", "signal_2", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("First claim failed: %v", err)
		}
		if result1.Status != ClaimStatusSuccess {
			t.Fatalf("Expected first claim to succeed")
		}

		// Second claim should return duplicate
		result2, err := store.Claim(ctx, "org-2", "key-2", "wfx-2", "signal_2", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("Second claim failed unexpectedly: %v", err)
		}

		if result2.Status != ClaimStatusDuplicate {
			t.Errorf("Expected ClaimStatusDuplicate, got %v", result2.Status)
		}

		if result2.Record == nil {
			t.Fatalf("Expected record for duplicate claim")
		}

		if result2.Record.ExecutionID != "wfx-2" {
			t.Errorf("Expected execution_id wfx-2, got %s", result2.Record.ExecutionID)
		}
	})

	t.Run("same key different org succeeds", func(t *testing.T) {
		// Claim in org-a
		result1, err := store.Claim(ctx, "org-a", "shared-key", "wfx-a", "signal", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("Claim in org-a failed: %v", err)
		}
		if result1.Status != ClaimStatusSuccess {
			t.Fatalf("Expected claim in org-a to succeed")
		}

		// Same key in org-b should succeed (different scope)
		result2, err := store.Claim(ctx, "org-b", "shared-key", "wfx-b", "signal", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("Claim in org-b failed: %v", err)
		}

		if result2.Status != ClaimStatusSuccess {
			t.Errorf("Expected ClaimStatusSuccess for different org, got %v", result2.Status)
		}
	})

	t.Run("claim with short TTL allows reuse after expiration", func(t *testing.T) {
		shortTTL := 100 * time.Millisecond

		// First claim with short TTL
		result1, err := store.Claim(ctx, "org-ttl", "ttl-key", "wfx-1", "signal", shortTTL)
		if err != nil {
			t.Fatalf("First claim failed: %v", err)
		}
		if result1.Status != ClaimStatusSuccess {
			t.Fatalf("Expected first claim to succeed")
		}

		// Wait for expiration
		time.Sleep(150 * time.Millisecond)

		// Second claim should succeed after expiration (cleanup happens on claim)
		result2, err := store.Claim(ctx, "org-ttl", "ttl-key", "wfx-2", "signal", shortTTL)
		if err != nil {
			t.Fatalf("Second claim failed: %v", err)
		}

		if result2.Status != ClaimStatusSuccess {
			t.Errorf("Expected ClaimStatusSuccess after TTL expiration, got %v", result2.Status)
		}
	})
}

func TestSignalDedupeStore_MarkDelivered(t *testing.T) {
	store := setupTestStore(t)
	ctx := context.Background()

	t.Run("mark claimed key as delivered", func(t *testing.T) {
		// First claim the key
		result, err := store.Claim(ctx, "org-mark", "mark-key", "wfx-1", "signal", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("Claim failed: %v", err)
		}
		if result.Status != ClaimStatusSuccess {
			t.Fatalf("Expected claim to succeed")
		}

		// Mark as delivered
		err = store.MarkDelivered(ctx, "org-mark", "mark-key")
		if err != nil {
			t.Errorf("MarkDelivered failed: %v", err)
		}

		// Subsequent claim should still return duplicate (key is still valid)
		result2, err := store.Claim(ctx, "org-mark", "mark-key", "wfx-2", "signal", DefaultSignalDedupeTTL)
		if err != nil {
			t.Fatalf("Subsequent claim failed: %v", err)
		}

		if result2.Status != ClaimStatusDuplicate {
			t.Errorf("Expected ClaimStatusDuplicate after mark delivered, got %v", result2.Status)
		}

		if result2.Record == nil {
			t.Fatalf("Expected record for duplicate claim")
		}

		if result2.Record.Status != StatusDelivered {
			t.Errorf("Expected status DELIVERED, got %s", result2.Record.Status)
		}
	})

	t.Run("mark non-existent key does not error", func(t *testing.T) {
		// Should not error for non-existent key (graceful handling)
		err := store.MarkDelivered(ctx, "org-none", "non-existent-key")
		if err != nil {
			t.Errorf("MarkDelivered should not error for non-existent key: %v", err)
		}
	})
}

func TestSignalDedupeStore_KeyComposition(t *testing.T) {
	t.Run("buildDedupeKey creates correct format", func(t *testing.T) {
		key := buildDedupeKey("org-123", "stripe:evt_abc")
		expected := "org-123:stripe:evt_abc"

		if key != expected {
			t.Errorf("Expected key %q, got %q", expected, key)
		}
	})

	t.Run("keys with special characters are handled", func(t *testing.T) {
		// UUID-style key
		key1 := buildDedupeKey("org-x", "550e8400-e29b-41d4-a716-446655440000")
		if key1 != "org-x:550e8400-e29b-41d4-a716-446655440000" {
			t.Errorf("UUID key not handled correctly: %s", key1)
		}

		// Webhook-style key with colon
		key2 := buildDedupeKey("org-y", "github:12345678")
		if key2 != "org-y:github:12345678" {
			t.Errorf("Webhook key not handled correctly: %s", key2)
		}
	})
}

func TestSignalDedupeStore_TableCreation(t *testing.T) {
	db := setupTestDB(t)

	// Creating store should create the table
	_, err := NewSQLiteSignalDedupeStore(db)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	// Verify table exists
	var tableName string
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='signal_dedupe'").Scan(&tableName)
	if err != nil {
		t.Errorf("signal_dedupe table not created: %v", err)
	}

	// Verify indexes exist
	var indexCount int
	err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='signal_dedupe'").Scan(&indexCount)
	if err != nil {
		t.Errorf("Failed to count indexes: %v", err)
	}

	// Should have at least 2 indexes (org and expires_at)
	if indexCount < 2 {
		t.Errorf("Expected at least 2 indexes, found %d", indexCount)
	}
}

// =============================================================================
// Error Handling Tests
// =============================================================================

func TestSignalDedupeStore_ErrorCases(t *testing.T) {
	t.Run("isUniqueConstraintError detects SQLite constraint errors", func(t *testing.T) {
		tests := []struct {
			errMsg   string
			expected bool
		}{
			{"UNIQUE constraint failed: signal_dedupe.id", true},
			{"duplicate key value violates unique constraint", true},
			{"some other error", false},
			{"", false},
		}

		for _, tt := range tests {
			var err error
			if tt.errMsg != "" {
				err = &testError{msg: tt.errMsg}
			}
			result := isUniqueConstraintError(err)
			if result != tt.expected {
				t.Errorf("isUniqueConstraintError(%q) = %v, expected %v", tt.errMsg, result, tt.expected)
			}
		}
	})
}

// testError is a simple error implementation for testing
type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}
