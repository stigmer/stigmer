package oauth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

// OAuthGrant is the Go representation of the OAuthGrant infrastructure record.
// Not an API resource — stored directly in SQLite, keyed by
// (identity_account_id, resource_id, org_id).
//
// Resource-agnostic: resource_id can refer to any API resource kind
// (e.g., MCP server, workflow) that requires OAuth credentials.
type OAuthGrant struct {
	IdentityAccountID    string
	ResourceID           string
	ResourceKind         string // e.g., "mcp_server", "workflow"
	OrgID                string
	AccessTokenExpiresAt int64
	ClientID             string
	AuthMethod           string // "mcp_oauth" or "vendor_oauth"
	TokenEndpoint        string
	AccessTokenEnvVar    string
	RefreshTokenEnvVar   string
	EnvironmentID        string
	CreatedAt            int64
	UpdatedAt            int64
}

// OAuthGrantStore manages OAuthGrant records in SQLite.
type OAuthGrantStore struct {
	db *sql.DB
}

// NewOAuthGrantStore creates a new store and ensures the table exists.
func NewOAuthGrantStore(db *sql.DB) (*OAuthGrantStore, error) {
	s := &OAuthGrantStore{db: db}
	if err := s.ensureTable(); err != nil {
		return nil, fmt.Errorf("failed to create oauth_grant table: %w", err)
	}
	return s, nil
}

func (s *OAuthGrantStore) ensureTable() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS oauth_grant (
			identity_account_id    TEXT NOT NULL,
			resource_id            TEXT NOT NULL,
			resource_kind          TEXT NOT NULL DEFAULT '',
			org_id                 TEXT NOT NULL DEFAULT '',
			access_token_expires_at INTEGER NOT NULL DEFAULT 0,
			client_id              TEXT NOT NULL DEFAULT '',
			auth_method            TEXT NOT NULL DEFAULT '',
			token_endpoint         TEXT NOT NULL DEFAULT '',
			access_token_env_var   TEXT NOT NULL DEFAULT '',
			refresh_token_env_var  TEXT NOT NULL DEFAULT '',
			environment_id         TEXT NOT NULL DEFAULT '',
			created_at             INTEGER NOT NULL,
			updated_at             INTEGER NOT NULL,
			PRIMARY KEY (identity_account_id, resource_id, org_id)
		)
	`)
	return err
}

// Upsert creates or replaces an OAuthGrant record.
func (s *OAuthGrantStore) Upsert(ctx context.Context, grant *OAuthGrant) error {
	now := time.Now().Unix()
	if grant.CreatedAt == 0 {
		grant.CreatedAt = now
	}
	grant.UpdatedAt = now

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO oauth_grant (
			identity_account_id, resource_id, resource_kind, org_id,
			access_token_expires_at, client_id, auth_method, token_endpoint,
			access_token_env_var, refresh_token_env_var, environment_id,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (identity_account_id, resource_id, org_id) DO UPDATE SET
			resource_kind = excluded.resource_kind,
			access_token_expires_at = excluded.access_token_expires_at,
			client_id = excluded.client_id,
			auth_method = excluded.auth_method,
			token_endpoint = excluded.token_endpoint,
			access_token_env_var = excluded.access_token_env_var,
			refresh_token_env_var = excluded.refresh_token_env_var,
			environment_id = excluded.environment_id,
			updated_at = excluded.updated_at
	`,
		grant.IdentityAccountID, grant.ResourceID, grant.ResourceKind, grant.OrgID,
		grant.AccessTokenExpiresAt, grant.ClientID, grant.AuthMethod, grant.TokenEndpoint,
		grant.AccessTokenEnvVar, grant.RefreshTokenEnvVar, grant.EnvironmentID,
		grant.CreatedAt, grant.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert oauth grant: %w", err)
	}

	log.Debug().
		Str("identity_account_id", grant.IdentityAccountID).
		Str("resource_id", grant.ResourceID).
		Str("resource_kind", grant.ResourceKind).
		Str("org_id", grant.OrgID).
		Msg("Upserted OAuth grant")
	return nil
}

// Find retrieves an OAuthGrant by its composite key.
// Returns nil, nil if no grant exists.
func (s *OAuthGrantStore) Find(ctx context.Context, identityAccountID, resourceID, orgID string) (*OAuthGrant, error) {
	grant := &OAuthGrant{}
	err := s.db.QueryRowContext(ctx, `
		SELECT identity_account_id, resource_id, resource_kind, org_id,
			access_token_expires_at, client_id, auth_method, token_endpoint,
			access_token_env_var, refresh_token_env_var, environment_id,
			created_at, updated_at
		FROM oauth_grant
		WHERE identity_account_id = ? AND resource_id = ? AND org_id = ?
	`, identityAccountID, resourceID, orgID).Scan(
		&grant.IdentityAccountID, &grant.ResourceID, &grant.ResourceKind, &grant.OrgID,
		&grant.AccessTokenExpiresAt, &grant.ClientID, &grant.AuthMethod, &grant.TokenEndpoint,
		&grant.AccessTokenEnvVar, &grant.RefreshTokenEnvVar, &grant.EnvironmentID,
		&grant.CreatedAt, &grant.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get oauth grant: %w", err)
	}
	return grant, nil
}

// Delete removes an OAuthGrant by its composite key.
func (s *OAuthGrantStore) Delete(ctx context.Context, identityAccountID, resourceID, orgID string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM oauth_grant
		WHERE identity_account_id = ? AND resource_id = ? AND org_id = ?
	`, identityAccountID, resourceID, orgID)
	if err != nil {
		return fmt.Errorf("failed to delete oauth grant: %w", err)
	}
	return nil
}
