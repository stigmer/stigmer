package oauth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

const pendingStateTTL = 10 * time.Minute

// PendingOAuthState holds the ephemeral state between initiateOAuthConnect
// and completeOAuthConnect. Expires after 10 minutes.
//
// CodeVerifier and ClientSecret rest sealed (enc:v1:) — the controllers
// seal/unseal at their seams (oss#394); this store persists whatever bytes
// it is handed, byte-faithfully.
type PendingOAuthState struct {
	State             string // Random, lookup key + CSRF protection
	CodeVerifier      string // PKCE, needed for token exchange; sealed at rest
	ClientID          string // From DCR response or OAuthApp
	ClientSecret      string // Empty for DCR/public clients; from OAuthApp for vendor OAuth; sealed at rest when non-empty
	TokenEndpoint     string // Discovered or from OAuthApp
	McpServerID       string
	IdentityAccountID string
	TargetEnvVar      string // From McpServer auth block
	AuthMethod        string // "mcp_oauth" or "vendor_oauth"
	TokenAuthMethod   string // RFC 8414 string from OAuthAppSpec (TokenAuthMethodBasic/-Post); empty for DCR
	RedirectURI       string // The redirect URI used in the auth request
	Org               string // Caller's org for personal environment resolution
	CreatedAt         int64
}

// PendingOAuthStateStore manages ephemeral OAuth state in SQLite.
type PendingOAuthStateStore struct {
	db *sql.DB
}

// NewPendingOAuthStateStore creates a new store and ensures the table exists.
func NewPendingOAuthStateStore(db *sql.DB) (*PendingOAuthStateStore, error) {
	s := &PendingOAuthStateStore{db: db}
	if err := s.ensureTable(); err != nil {
		return nil, fmt.Errorf("failed to create pending_oauth_state table: %w", err)
	}
	return s, nil
}

func (s *PendingOAuthStateStore) ensureTable() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS pending_oauth_state (
			state               TEXT PRIMARY KEY,
			code_verifier       TEXT NOT NULL,
			client_id           TEXT NOT NULL DEFAULT '',
			client_secret       TEXT NOT NULL DEFAULT '',
			token_endpoint      TEXT NOT NULL DEFAULT '',
			mcp_server_id       TEXT NOT NULL,
			identity_account_id TEXT NOT NULL,
			target_env_var      TEXT NOT NULL DEFAULT '',
			auth_method         TEXT NOT NULL DEFAULT '',
			token_auth_method   TEXT NOT NULL DEFAULT '',
			redirect_uri        TEXT NOT NULL DEFAULT '',
			org                 TEXT NOT NULL DEFAULT '',
			created_at          INTEGER NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	// Add columns to existing tables (idempotent — SQLite ignores if exists)
	_, _ = s.db.Exec(`ALTER TABLE pending_oauth_state ADD COLUMN org TEXT NOT NULL DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE pending_oauth_state ADD COLUMN token_auth_method TEXT NOT NULL DEFAULT ''`)
	return nil
}

// Save persists a PendingOAuthState record.
func (s *PendingOAuthStateStore) Save(ctx context.Context, state *PendingOAuthState) error {
	if state.CreatedAt == 0 {
		state.CreatedAt = time.Now().Unix()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO pending_oauth_state (
			state, code_verifier, client_id, client_secret, token_endpoint,
			mcp_server_id, identity_account_id, target_env_var, auth_method,
			token_auth_method, redirect_uri, org, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		state.State, state.CodeVerifier, state.ClientID, state.ClientSecret,
		state.TokenEndpoint, state.McpServerID, state.IdentityAccountID,
		state.TargetEnvVar, state.AuthMethod, state.TokenAuthMethod,
		state.RedirectURI, state.Org, state.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save pending oauth state: %w", err)
	}

	log.Debug().
		Str("state", state.State[:8]+"...").
		Str("mcp_server_id", state.McpServerID).
		Msg("Saved pending OAuth state")
	return nil
}

// GetAndDelete atomically retrieves and deletes a PendingOAuthState by state
// parameter. Returns nil, nil if no state exists or if it has expired.
func (s *PendingOAuthStateStore) GetAndDelete(ctx context.Context, stateParam string) (*PendingOAuthState, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	state := &PendingOAuthState{}
	err = tx.QueryRowContext(ctx, `
		SELECT state, code_verifier, client_id, client_secret, token_endpoint,
			mcp_server_id, identity_account_id, target_env_var, auth_method,
			token_auth_method, redirect_uri, org, created_at
		FROM pending_oauth_state
		WHERE state = ?
	`, stateParam).Scan(
		&state.State, &state.CodeVerifier, &state.ClientID, &state.ClientSecret,
		&state.TokenEndpoint, &state.McpServerID, &state.IdentityAccountID,
		&state.TargetEnvVar, &state.AuthMethod, &state.TokenAuthMethod,
		&state.RedirectURI, &state.Org, &state.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get pending oauth state: %w", err)
	}

	if time.Since(time.Unix(state.CreatedAt, 0)) > pendingStateTTL {
		_, _ = tx.ExecContext(ctx, `DELETE FROM pending_oauth_state WHERE state = ?`, stateParam)
		_ = tx.Commit()
		return nil, nil
	}

	_, err = tx.ExecContext(ctx, `DELETE FROM pending_oauth_state WHERE state = ?`, stateParam)
	if err != nil {
		return nil, fmt.Errorf("failed to delete pending oauth state: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return state, nil
}

// CleanupExpired removes all expired pending OAuth states.
// Should be called periodically (e.g., on server startup or a timer).
func (s *PendingOAuthStateStore) CleanupExpired(ctx context.Context) (int64, error) {
	cutoff := time.Now().Add(-pendingStateTTL).Unix()
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM pending_oauth_state WHERE created_at < ?
	`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("failed to cleanup expired pending oauth states: %w", err)
	}
	return result.RowsAffected()
}
