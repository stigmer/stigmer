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
// Mongo — so the bootstrap identity must exist before any authenticated call.
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

	doc := bson.D{
		{Key: "apiVersion", Value: "iam.stigmer.ai/v1"},
		{Key: "kind", Value: "IdentityAccount"},
		{Key: "metadata", Value: bson.D{
			{Key: "id", Value: input.ID},
			{Key: "name", Value: input.Name},
		}},
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

// SeedBillingPolicies inserts the default billing policies into the
// billing_policy collection. The Java service normally creates these via
// Mongock migration, but Mongock is disabled in the integration test
// environment. Without these policies, the DebitBillingStep fails with
// "No active billing policy for harness=cursor" and customerBillableAmountMicros
// remains zero.
func (s *MongoSeeder) SeedBillingPolicies(ctx context.Context) error {
	coll := s.client.Database(s.dbName).Collection("billing_policy")

	policies := []bson.D{
		{
			{Key: "policy_id", Value: "native-v2"},
			{Key: "harness", Value: "native"},
			{Key: "cost_tier", Value: "default"},
			{Key: "markup_basis_points", Value: int32(12000)},
			{Key: "minimum_charge_micros", Value: int64(100)},
			{Key: "rounding_mode", Value: "nearest_micro"},
			{Key: "active", Value: true},
		},
		{
			{Key: "policy_id", Value: "cursor-v2"},
			{Key: "harness", Value: "cursor"},
			{Key: "cost_tier", Value: "default"},
			{Key: "markup_basis_points", Value: int32(11000)},
			{Key: "minimum_charge_micros", Value: int64(100)},
			{Key: "rounding_mode", Value: "nearest_micro"},
			{Key: "active", Value: true},
		},
	}

	for _, doc := range policies {
		policyID := ""
		for _, elem := range doc {
			if elem.Key == "policy_id" {
				policyID = elem.Value.(string)
				break
			}
		}
		count, err := coll.CountDocuments(ctx, bson.D{{Key: "policy_id", Value: policyID}})
		if err != nil {
			return fmt.Errorf("check billing policy %s: %w", policyID, err)
		}
		if count > 0 {
			continue
		}
		if _, err := coll.InsertOne(ctx, doc); err != nil {
			return fmt.Errorf("seed billing policy %s: %w", policyID, err)
		}
	}
	return nil
}

// EnsureBillingIndexes creates indexes that Mongock migrations normally
// create in production. Without the unique index on idempotency_key,
// duplicate billing records are inserted instead of being deduplicated.
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
