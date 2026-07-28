package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
)

// IdentitySeeder writes identity_account rows directly into the app-postgres
// system of record for documents that the Java service expects to find during
// production-mode security resolution. In production security mode (no
// STIGMER_SECURITY_MODE=test), the gRPC interceptor chain resolves JWT
// subjects to internal identity accounts via the persistence layer — so the
// bootstrap identity must exist before any authenticated call can succeed.
// That chicken-and-egg is the ONLY legitimate reason to seed a Tier-1 kind
// behind the service's back, and only the integration-security suite has it.
//
// Everything else must seed through the front door instead
// (CreateIdentityAccount / GrantOrgRole): direct writes are storage-coupled
// by definition. Billing policies and the machine account both graduated to
// service-owned startup seeders (BillingPolicySeeder, BootstrapIdentitySeeder)
// for exactly that reason; only the human bootstrap account and the federated
// test subjects remain genuinely pre-auth.
//
// Rows are written with psql inside the app-postgres container — the same
// device StartAppPostgres uses to create the checkpointer database — keeping
// the harness free of a Go Postgres driver dependency.
type IdentitySeeder struct {
	pg *AppPostgresContainer
}

// NewIdentitySeeder wraps the harness's app-postgres container. The container
// stays harness-owned; the seeder holds no connection and needs no Close.
func NewIdentitySeeder(pg *AppPostgresContainer) *IdentitySeeder {
	return &IdentitySeeder{pg: pg}
}

// SeedIdentityAccountInput holds the fields needed to create a minimal
// identity_account document that the Java service's RequestCallerIdentityMapper
// can resolve when processing an Auth0 or federated JWT.
type SeedIdentityAccountInput struct {
	// ID is the internal identity account ID (metadata.id).
	ID string
	// Slug is the account's human handle (metadata.slug). Optional;
	// seeded only when set (IdentityAccountRepo.findBySlug queries it —
	// the datastore binding validation's did-you-mean resolves slugs).
	Slug string
	// IdpID is the external identity provider subject (spec.idpId).
	// For Auth0 JWTs this is the JWT "sub" claim.
	IdpID string
	// Email is the account email (spec.email).
	Email string
	// Name is the display name (metadata.name).
	Name string
	// FirstName for spec.firstName.
	FirstName string
	// LastName for spec.lastName.
	LastName string
	// IsMachineAccount marks this as a service-to-service machine account
	// (e.g., the Auth0 client-credentials account used for internal gRPC calls).
	IsMachineAccount bool
}

// SeedIdentityAccount upserts an identity_account row. The document shape is
// the canonical proto-JSON the service's own adapter writes and what
// IdentityAccountRepo.findByIdpId() queries.
func (s *IdentitySeeder) SeedIdentityAccount(ctx context.Context, input SeedIdentityAccountInput) error {
	metadata := map[string]any{
		"id":   input.ID,
		"name": input.Name,
	}
	if input.Slug != "" {
		metadata["slug"] = input.Slug
	}

	doc := map[string]any{
		"apiVersion": "iam.stigmer.ai/v1",
		"kind":       "IdentityAccount",
		"metadata":   metadata,
		"spec": map[string]any{
			"idpId":            input.IdpID,
			"email":            input.Email,
			"firstName":        input.FirstName,
			"lastName":         input.LastName,
			"pictureUrl":       "",
			"isMachineAccount": input.IsMachineAccount,
		},
	}

	return s.upsert(ctx, input.ID, doc)
}

// SeedFederatedIdentityAccount upserts an identity_account row that is
// linked to a specific IdentityProvider via identityProviderRef. This is how
// FederatedIdentityResolver looks up accounts for federated JWT subjects.
func (s *IdentitySeeder) SeedFederatedIdentityAccount(ctx context.Context, input SeedIdentityAccountInput, idpOrg, idpSlug string) error {
	doc := map[string]any{
		"apiVersion": "iam.stigmer.ai/v1",
		"kind":       "IdentityAccount",
		"metadata": map[string]any{
			"id":   input.ID,
			"name": input.Name,
		},
		"spec": map[string]any{
			"idpId":      input.IdpID,
			"email":      input.Email,
			"firstName":  input.FirstName,
			"lastName":   input.LastName,
			"pictureUrl": "",
			"identityProviderRef": map[string]any{
				"org":  idpOrg,
				"slug": idpSlug,
			},
		},
	}

	return s.upsert(ctx, input.ID, doc)
}

// DeleteIdentityAccount removes an identity_account by its metadata.id.
func (s *IdentitySeeder) DeleteIdentityAccount(ctx context.Context, id string) error {
	return s.exec(ctx, fmt.Sprintf(
		"DELETE FROM s_iam.identity_account WHERE id = %s;", dollarQuote(id)))
}

// upsert replaces the row's document wholesale (mirroring the replace-upsert
// the Mongo-era seeder performed) while preserving created_at on re-seed.
// The id column is GENERATED from data->metadata->id, so the conflict target
// is the document identity itself.
func (s *IdentitySeeder) upsert(ctx context.Context, id string, doc map[string]any) error {
	data, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("marshal identity_account %s: %w", id, err)
	}
	return s.exec(ctx, fmt.Sprintf(
		`INSERT INTO s_iam.identity_account (data, created_at) VALUES (%s::jsonb, now())
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;`,
		dollarQuote(string(data))))
}

func (s *IdentitySeeder) exec(ctx context.Context, sql string) error {
	exitCode, output, err := s.pg.Container.Exec(ctx, []string{
		"psql", "-U", s.pg.User, "-d", s.pg.Database, "-v", "ON_ERROR_STOP=1", "-c", sql,
	})
	if err != nil {
		return fmt.Errorf("exec psql in app-postgres container: %w", err)
	}
	if exitCode != 0 {
		out, _ := io.ReadAll(output)
		return fmt.Errorf("psql exited %d: %s", exitCode, string(out))
	}
	return nil
}

// dollarQuote wraps a value as a PostgreSQL dollar-quoted string literal.
// The tag cannot appear in JSON-marshaled content or resource ids, so the
// literal is injection-safe without escaping.
func dollarQuote(v string) string {
	return "$stigmer_seed$" + v + "$stigmer_seed$"
}
