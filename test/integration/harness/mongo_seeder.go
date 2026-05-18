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
}

// SeedIdentityAccount upserts an identity_account document into MongoDB.
// The document shape matches what IntegrationTestDataSeeder creates in the
// Java service and what IdentityAccountRepo.findByIdpId() queries.
func (s *MongoSeeder) SeedIdentityAccount(ctx context.Context, input SeedIdentityAccountInput) error {
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
		}},
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

// Close disconnects the MongoDB client.
func (s *MongoSeeder) Close(ctx context.Context) error {
	return s.client.Disconnect(ctx)
}
