package harness

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const identityAccountCollection = "identity_account"

// MongoSeeder provides direct MongoDB access for pre-seeding documents that
// the Java service expects to find during production-mode security resolution.
// In production security mode (no STIGMER_SECURITY_MODE=test), the gRPC
// interceptor chain resolves JWT subjects to internal identity accounts via
// the persistence layer — so the bootstrap identity must exist before any
// authenticated call can succeed. That chicken-and-egg is the ONLY legitimate
// reason to seed a Tier-1 kind (identity_account, iam_policy) behind the
// service's back, and only the integration-security suite has it.
//
// Everything else must seed through the front door instead
// (CreateIdentityAccount / GrantOrgRole): direct writes are storage-coupled
// and land in Mongo even when the app-postgres lane
// (INTEGRATION_TEST_APP_POSTGRES) has moved the kind to Postgres — the seed
// would silently miss the store the service reads. Billing policies used to
// be seeded here for exactly that reason and were removed when stigmer-cloud's
// B1 slice ported billing_policy: the Java service now seeds its own active
// policy set at startup (BillingPolicySeeder), storage-neutrally, on every
// lane. EnsureBillingIndexes stays: it creates a Mongo INDEX (not data), which
// the Mongo lane still needs while llm_call_usage_record writes go to Mongo
// there, and which is a harmless no-op collection on the app-postgres lane
// (Postgres enforces the same uniqueness via its Flyway DDL).
type MongoSeeder struct {
	client *mongo.Client
	dbName string
}

// NewMongoSeeder connects to the test MongoDB instance. Call Close when done.
func NewMongoSeeder(ctx context.Context, mongoURI, dbName string) (*MongoSeeder, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(mongoURI))
	if err != nil {
		return nil, fmt.Errorf("connect to mongo for seeding: %w", err)
	}

	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("ping mongo: %w", err)
	}

	return &MongoSeeder{client: client, dbName: dbName}, nil
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

// SeedIdentityAccount upserts an identity_account document into MongoDB.
// The document shape matches what IntegrationTestDataSeeder creates in the
// Java service and what IdentityAccountRepo.findByIdpId() queries.
func (s *MongoSeeder) SeedIdentityAccount(ctx context.Context, input SeedIdentityAccountInput) error {
	coll := s.client.Database(s.dbName).Collection(identityAccountCollection)

	spec := bson.D{
		{Key: "idpId", Value: input.IdpID},
		{Key: "email", Value: input.Email},
		{Key: "firstName", Value: input.FirstName},
		{Key: "lastName", Value: input.LastName},
		{Key: "pictureUrl", Value: ""},
		{Key: "isMachineAccount", Value: input.IsMachineAccount},
	}

	metadata := bson.D{
		{Key: "id", Value: input.ID},
		{Key: "name", Value: input.Name},
	}
	if input.Slug != "" {
		metadata = append(metadata, bson.E{Key: "slug", Value: input.Slug})
	}

	doc := bson.D{
		{Key: "apiVersion", Value: "iam.stigmer.ai/v1"},
		{Key: "kind", Value: "IdentityAccount"},
		{Key: "metadata", Value: metadata},
		{Key: "spec", Value: spec},
	}

	filter := bson.D{{Key: "metadata.id", Value: input.ID}}
	opts := options.Replace().SetUpsert(true)

	_, err := coll.ReplaceOne(ctx, filter, doc, opts)
	if err != nil {
		return fmt.Errorf("upsert identity_account %s: %w", input.ID, err)
	}
	return nil
}

// SeedOrgMembership upserts an iam_policy document granting an identity
// account an assignable relation (owner/admin/member/viewer) on an
// organization — the Mongo policy mirror every production policy write
// persists alongside the OpenFGA tuple. The datastore binding-principal
// validation reads membership from exactly this mirror
// (IamPolicyRepo.findByPrincipalAndResource), so tests binding platform
// principals must seed it for the bound account.
func (s *MongoSeeder) SeedOrgMembership(ctx context.Context, identityAccountID, org, relation string) error {
	coll := s.client.Database(s.dbName).Collection("iam_policy")

	policyID := fmt.Sprintf("iampol-test-%s-%s-%s", identityAccountID, org, relation)
	doc := bson.D{
		{Key: "apiVersion", Value: "iam.stigmer.ai/v1"},
		{Key: "kind", Value: "IamPolicy"},
		{Key: "metadata", Value: bson.D{
			{Key: "id", Value: policyID},
			{Key: "org", Value: org},
		}},
		{Key: "spec", Value: bson.D{
			{Key: "principal", Value: bson.D{
				{Key: "kind", Value: "identity_account"},
				{Key: "id", Value: identityAccountID},
			}},
			{Key: "resource", Value: bson.D{
				{Key: "kind", Value: "organization"},
				{Key: "id", Value: org},
			}},
			{Key: "relation", Value: relation},
		}},
	}

	filter := bson.D{{Key: "metadata.id", Value: policyID}}
	opts := options.Replace().SetUpsert(true)

	if _, err := coll.ReplaceOne(ctx, filter, doc, opts); err != nil {
		return fmt.Errorf("upsert iam_policy %s: %w", policyID, err)
	}
	return nil
}

// SeedFederatedIdentityAccount upserts an identity_account document that is
// linked to a specific IdentityProvider via identityProviderRef. This is how
// FederatedIdentityResolver looks up accounts for federated JWT subjects.
func (s *MongoSeeder) SeedFederatedIdentityAccount(ctx context.Context, input SeedIdentityAccountInput, idpOrg, idpSlug string) error {
	coll := s.client.Database(s.dbName).Collection(identityAccountCollection)

	doc := bson.D{
		{Key: "apiVersion", Value: "iam.stigmer.ai/v1"},
		{Key: "kind", Value: "IdentityAccount"},
		{Key: "metadata", Value: bson.D{
			{Key: "id", Value: input.ID},
			{Key: "name", Value: input.Name},
		}},
		{Key: "spec", Value: bson.D{
			{Key: "idpId", Value: input.IdpID},
			{Key: "email", Value: input.Email},
			{Key: "firstName", Value: input.FirstName},
			{Key: "lastName", Value: input.LastName},
			{Key: "pictureUrl", Value: ""},
			{Key: "identityProviderRef", Value: bson.D{
				{Key: "org", Value: idpOrg},
				{Key: "slug", Value: idpSlug},
			}},
		}},
	}

	filter := bson.D{{Key: "metadata.id", Value: input.ID}}
	opts := options.Replace().SetUpsert(true)

	_, err := coll.ReplaceOne(ctx, filter, doc, opts)
	if err != nil {
		return fmt.Errorf("upsert federated identity_account %s: %w", input.ID, err)
	}
	return nil
}

// DeleteIdentityAccount removes an identity_account by its metadata.id.
func (s *MongoSeeder) DeleteIdentityAccount(ctx context.Context, id string) error {
	coll := s.client.Database(s.dbName).Collection(identityAccountCollection)
	_, err := coll.DeleteOne(ctx, bson.D{{Key: "metadata.id", Value: id}})
	return err
}

// EnsureBillingIndexes creates indexes that Mongock migrations normally
// create in production. Without the unique index on idempotency_key,
// duplicate billing records are inserted instead of being deduplicated.
// Index-only (no data): safe on both storage lanes — see the type comment.
func (s *MongoSeeder) EnsureBillingIndexes(ctx context.Context) error {
	coll := s.client.Database(s.dbName).Collection("llm_call_usage_record")
	_, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "idempotency_key", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("idx_idempotency_key_unique"),
	})
	if err != nil {
		return fmt.Errorf("create idempotency_key unique index: %w", err)
	}
	return nil
}

// Close disconnects the MongoDB client.
func (s *MongoSeeder) Close(ctx context.Context) error {
	return s.client.Disconnect(ctx)
}
