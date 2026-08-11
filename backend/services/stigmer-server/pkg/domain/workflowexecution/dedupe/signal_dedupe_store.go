// Package dedupe provides signal deduplication for workflow executions.
//
// This package implements Gap B2 (Event Dedupe) to prevent duplicate signal
// processing when external events (webhooks, API callbacks) are retried.
//
// Key concepts:
//   - Idempotency keys are scoped per-organization to prevent cross-org collisions
//   - Records expire after a configurable TTL (default 24 hours)
//   - Claims use atomic insert operations for concurrency safety
//
// @since Gap B2 (Event Dedupe)
package dedupe

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// =============================================================================
// Errors
// =============================================================================

// ErrDuplicateSignal is returned when a signal with the same idempotency key
// has already been delivered within the TTL window.
var ErrDuplicateSignal = errors.New("duplicate signal: already delivered")

// ErrClaimFailed is returned when claiming an idempotency key fails due to
// concurrent requests (another process claimed it first).
var ErrClaimFailed = errors.New("claim failed: key already claimed")

// =============================================================================
// Signal Dedupe Record
// =============================================================================

// SignalDedupeStatus represents the status of a dedupe record.
type SignalDedupeStatus string

const (
	// StatusClaimed indicates the signal is being processed.
	StatusClaimed SignalDedupeStatus = "CLAIMED"
	// StatusDelivered indicates the signal was successfully delivered.
	StatusDelivered SignalDedupeStatus = "DELIVERED"
)

// SignalDedupeRecord represents a deduplicated signal record.
type SignalDedupeRecord struct {
	// ID is the unique identifier: "{org}:{idempotency_key}"
	ID string

	// Org is the organization that owns the workflow execution.
	Org string

	// IdempotencyKey is the caller-provided key for deduplication.
	IdempotencyKey string

	// ExecutionID is the workflow execution that received the signal.
	ExecutionID string

	// SignalName is the name of the signal that was sent.
	SignalName string

	// Status indicates whether the signal was claimed or delivered.
	Status SignalDedupeStatus

	// CreatedAt is when the record was first created (claim time).
	CreatedAt time.Time

	// DeliveredAt is when the signal was successfully delivered.
	// Zero value if not yet delivered.
	DeliveredAt time.Time

	// ExpiresAt is when the record expires and can be reused.
	ExpiresAt time.Time
}

// =============================================================================
// Claim Result
// =============================================================================

// ClaimResult represents the result of attempting to claim an idempotency key.
type ClaimResult struct {
	// Status indicates whether the claim was successful or found a duplicate.
	Status ClaimStatus

	// Record is the existing record if Status is ClaimStatusDuplicate.
	// Nil if Status is ClaimStatusSuccess.
	Record *SignalDedupeRecord
}

// ClaimStatus represents the outcome of a claim operation.
type ClaimStatus string

const (
	// ClaimStatusSuccess indicates the key was successfully claimed.
	ClaimStatusSuccess ClaimStatus = "SUCCESS"
	// ClaimStatusDuplicate indicates the key was already used.
	ClaimStatusDuplicate ClaimStatus = "DUPLICATE"
)

// =============================================================================
// Signal Dedupe Store Interface
// =============================================================================

// SignalDedupeStore provides signal deduplication operations.
type SignalDedupeStore interface {
	// Claim attempts to claim an idempotency key for a signal.
	// If the key is already claimed or delivered, returns the existing record.
	//
	// Parameters:
	//   - ctx: context for cancellation
	//   - org: organization ID (key scope)
	//   - idempotencyKey: caller-provided key
	//   - executionID: workflow execution ID
	//   - signalName: name of the signal
	//   - ttl: how long the record should be valid
	//
	// Returns:
	//   - ClaimResult with status and optional existing record
	//   - error if database operation fails
	Claim(ctx context.Context, org, idempotencyKey, executionID, signalName string, ttl time.Duration) (*ClaimResult, error)

	// MarkDelivered updates a claimed record to delivered status.
	// Should be called after the signal has been successfully sent to Temporal.
	//
	// Parameters:
	//   - ctx: context for cancellation
	//   - org: organization ID (key scope)
	//   - idempotencyKey: caller-provided key
	//
	// Returns:
	//   - error if record doesn't exist or update fails
	MarkDelivered(ctx context.Context, org, idempotencyKey string) error

	// Close releases any resources held by the store.
	Close() error
}

// =============================================================================
// SQLite Implementation
// =============================================================================

// SQLiteSignalDedupeStore implements SignalDedupeStore using SQLite.
// It uses the same database as the main store but with a dedicated table.
type SQLiteSignalDedupeStore struct {
	db *sql.DB
}

// NewSQLiteSignalDedupeStore creates a new SQLite-backed dedupe store.
// It creates the signal_dedupe table if it doesn't exist.
func NewSQLiteSignalDedupeStore(db *sql.DB) (*SQLiteSignalDedupeStore, error) {
	store := &SQLiteSignalDedupeStore{db: db}

	// Create table if not exists
	if err := store.createTable(); err != nil {
		return nil, fmt.Errorf("create signal_dedupe table: %w", err)
	}

	return store, nil
}

// createTable creates the signal_dedupe table and indexes.
func (s *SQLiteSignalDedupeStore) createTable() error {
	// Create the table
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS signal_dedupe (
			id TEXT PRIMARY KEY,
			org TEXT NOT NULL,
			idempotency_key TEXT NOT NULL,
			execution_id TEXT NOT NULL,
			signal_name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'CLAIMED',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			delivered_at TEXT,
			expires_at TEXT NOT NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("create table: %w", err)
	}

	// Create index on org for efficient cleanup
	_, err = s.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_signal_dedupe_org ON signal_dedupe(org)
	`)
	if err != nil {
		return fmt.Errorf("create org index: %w", err)
	}

	// Create index on expires_at for TTL cleanup
	_, err = s.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_signal_dedupe_expires ON signal_dedupe(expires_at)
	`)
	if err != nil {
		return fmt.Errorf("create expires index: %w", err)
	}

	return nil
}

// Claim implements SignalDedupeStore.Claim.
func (s *SQLiteSignalDedupeStore) Claim(
	ctx context.Context,
	org, idempotencyKey, executionID, signalName string,
	ttl time.Duration,
) (*ClaimResult, error) {
	id := buildDedupeKey(org, idempotencyKey)
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	log.Debug().
		Str("id", id).
		Str("org", org).
		Str("idempotency_key", idempotencyKey).
		Str("execution_id", executionID).
		Dur("ttl", ttl).
		Msg("Attempting to claim idempotency key")

	// First, clean up expired records to allow reuse
	if err := s.cleanupExpired(ctx); err != nil {
		log.Warn().Err(err).Msg("Failed to cleanup expired dedupe records")
		// Continue - this is not critical
	}

	// Try to insert a new record
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO signal_dedupe (id, org, idempotency_key, execution_id, signal_name, status, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, 'CLAIMED', ?, ?)
	`, id, org, idempotencyKey, executionID, signalName, now.Format(time.RFC3339Nano), expiresAt.Format(time.RFC3339Nano))

	if err == nil {
		// Successfully claimed
		log.Info().
			Str("id", id).
			Str("execution_id", executionID).
			Msg("Successfully claimed idempotency key")

		return &ClaimResult{Status: ClaimStatusSuccess}, nil
	}

	// Check if it's a unique constraint violation (duplicate key)
	// SQLite returns "UNIQUE constraint failed" error
	if isUniqueConstraintError(err) {
		// Load existing record
		record, loadErr := s.loadRecord(ctx, id)
		if loadErr != nil {
			return nil, fmt.Errorf("load existing record: %w", loadErr)
		}

		log.Info().
			Str("id", id).
			Str("existing_execution_id", record.ExecutionID).
			Str("status", string(record.Status)).
			Msg("Idempotency key already claimed (duplicate)")

		return &ClaimResult{
			Status: ClaimStatusDuplicate,
			Record: record,
		}, nil
	}

	return nil, fmt.Errorf("claim idempotency key: %w", err)
}

// MarkDelivered implements SignalDedupeStore.MarkDelivered.
func (s *SQLiteSignalDedupeStore) MarkDelivered(ctx context.Context, org, idempotencyKey string) error {
	id := buildDedupeKey(org, idempotencyKey)
	now := time.Now().UTC()

	result, err := s.db.ExecContext(ctx, `
		UPDATE signal_dedupe
		SET status = 'DELIVERED', delivered_at = ?
		WHERE id = ? AND status = 'CLAIMED'
	`, now.Format(time.RFC3339Nano), id)
	if err != nil {
		return fmt.Errorf("mark delivered: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		log.Warn().
			Str("id", id).
			Msg("No record updated - may be already delivered or doesn't exist")
	} else {
		log.Debug().
			Str("id", id).
			Msg("Marked idempotency key as delivered")
	}

	return nil
}

// Close implements SignalDedupeStore.Close.
func (s *SQLiteSignalDedupeStore) Close() error {
	// The db connection is owned by the main store, don't close it here
	return nil
}

// loadRecord loads a dedupe record by ID.
func (s *SQLiteSignalDedupeStore) loadRecord(ctx context.Context, id string) (*SignalDedupeRecord, error) {
	var record SignalDedupeRecord
	var createdAtStr, expiresAtStr string
	var deliveredAtStr sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, org, idempotency_key, execution_id, signal_name, status, created_at, delivered_at, expires_at
		FROM signal_dedupe
		WHERE id = ?
	`, id).Scan(
		&record.ID,
		&record.Org,
		&record.IdempotencyKey,
		&record.ExecutionID,
		&record.SignalName,
		&record.Status,
		&createdAtStr,
		&deliveredAtStr,
		&expiresAtStr,
	)
	if err != nil {
		return nil, fmt.Errorf("query record: %w", err)
	}

	// Parse timestamps
	record.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAtStr)
	record.ExpiresAt, _ = time.Parse(time.RFC3339Nano, expiresAtStr)
	if deliveredAtStr.Valid {
		record.DeliveredAt, _ = time.Parse(time.RFC3339Nano, deliveredAtStr.String)
	}

	return &record, nil
}

// cleanupExpired removes expired records to allow key reuse.
func (s *SQLiteSignalDedupeStore) cleanupExpired(ctx context.Context) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)

	result, err := s.db.ExecContext(ctx, `
		DELETE FROM signal_dedupe WHERE expires_at < ?
	`, now)
	if err != nil {
		return fmt.Errorf("delete expired: %w", err)
	}

	if rowsAffected, _ := result.RowsAffected(); rowsAffected > 0 {
		log.Debug().Int64("count", rowsAffected).Msg("Cleaned up expired dedupe records")
	}

	return nil
}

// =============================================================================
// Helper Functions
// =============================================================================

// buildDedupeKey constructs the composite key for deduplication.
// Format: "{org}:{idempotency_key}"
func buildDedupeKey(org, idempotencyKey string) string {
	return fmt.Sprintf("%s:%s", org, idempotencyKey)
}

// isUniqueConstraintError checks if the error is a unique constraint violation.
func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	// SQLite unique constraint error message
	errStr := err.Error()
	return strings.Contains(errStr, "UNIQUE constraint failed") ||
		strings.Contains(errStr, "duplicate key")
}

// =============================================================================
// Default TTL
// =============================================================================

// DefaultSignalDedupeTTL is the default TTL for signal dedupe records (24 hours).
// This matches industry standards like Stripe's idempotency key retention.
const DefaultSignalDedupeTTL = 24 * time.Hour
