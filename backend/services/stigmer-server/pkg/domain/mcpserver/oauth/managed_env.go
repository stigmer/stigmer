package oauth

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
)

const managedEnvLabel = "stigmer.ai/managed"

// ManagedEnvironmentService creates and manages system-controlled environments
// for storing OAuth tokens. Each managed environment is scoped to a single
// (user, resource, org) tuple and identified by the stigmer.ai/managed=true label.
//
// All operations go through the downstream environment gRPC client, which
// provides encryption, validation, and audit automatically via the environment
// pipeline. This is a deliberate cross-domain access, analogous to the
// OAuthAppRepo access in OAuthTokenRefreshService.
type ManagedEnvironmentService struct {
	environmentClient *environment.Client
}

// NewManagedEnvironmentService creates a new service backed by the given
// downstream environment client.
func NewManagedEnvironmentService(envClient *environment.Client) *ManagedEnvironmentService {
	return &ManagedEnvironmentService{environmentClient: envClient}
}

// CreateManagedEnvironment creates a new system-managed environment with the
// stigmer.ai/managed=true label. Returns the environment's resource ID.
//
// The environment goes through the standard create pipeline, which handles
// ID generation, slug resolution, timestamps, and search indexing.
func (s *ManagedEnvironmentService) CreateManagedEnvironment(
	ctx context.Context,
	name string,
	org string,
) (string, error) {
	created, err := s.environmentClient.Create(ctx, &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
			Labels: map[string]string{
				managedEnvLabel: "true",
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create managed environment: %w", err)
	}

	envID := created.GetMetadata().GetId()

	log.Info().
		Str("environment_id", envID).
		Str("name", name).
		Str("org", org).
		Msg("Created managed environment for OAuth token storage")

	return envID, nil
}

// DeleteManagedEnvironment deletes a managed environment and all its secrets.
// The environment pipeline handles cleanup of encryption keys, labels, and
// search index entries.
//
// Non-fatal callers should catch errors — the environment may already be
// deleted (e.g., concurrent disconnect calls or partial failure retries).
func (s *ManagedEnvironmentService) DeleteManagedEnvironment(
	ctx context.Context,
	environmentID string,
) error {
	_, err := s.environmentClient.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: environmentID,
	})
	if err != nil {
		return fmt.Errorf("failed to delete managed environment %s: %w", environmentID, err)
	}

	log.Info().
		Str("environment_id", environmentID).
		Msg("Deleted managed environment")

	return nil
}

// UpdateSecrets writes secret variables into a managed environment.
// Values must be plaintext (never enc:v<N>:-prefixed — the environment
// pipeline rejects ciphertext-shaped input, oss#395) and are stored as
// passed: the OSS environment pipeline does not encrypt at write time
// (at-rest encryption for environment values is tracked separately).
func (s *ManagedEnvironmentService) UpdateSecrets(
	ctx context.Context,
	environmentID string,
	variables map[string]*environmentv1.EnvironmentValue,
) error {
	_, err := s.environmentClient.UpdateVariables(ctx, &environmentv1.UpdateEnvironmentVariablesRequest{
		EnvironmentId: environmentID,
		Variables:     variables,
	})
	if err != nil {
		return fmt.Errorf("failed to update secrets in managed environment %s: %w", environmentID, err)
	}
	return nil
}

// ReadSecretValue retrieves a single decrypted secret value from a managed
// environment. Returns the plaintext value.
func (s *ManagedEnvironmentService) ReadSecretValue(
	ctx context.Context,
	environmentID string,
	key string,
) (string, error) {
	val, err := s.environmentClient.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
		EnvironmentId: environmentID,
		Key:           key,
	})
	if err != nil {
		return "", fmt.Errorf("failed to read secret %q from managed environment %s: %w", key, environmentID, err)
	}
	return val.GetValue(), nil
}
