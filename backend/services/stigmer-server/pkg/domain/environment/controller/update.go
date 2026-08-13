package environment

import (
	"context"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing environment using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing environment from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. PreserveRedactedSecrets - Restore marker-carrying secrets, reject enc:v<N>: input
// 6. EncryptSecretValues - Encrypt is_secret values at rest (marker-restored ciphertext passes through unchanged)
// 7. NormalizeReferences - Normalize cross-references
// 8. Persist - Save updated environment to repository
// 9. IndexSearch - Update search index
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *EnvironmentController) Update(ctx context.Context, environment *environmentv1.Environment) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, environment)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Redact AFTER persist: the store keeps ciphertext, the response
	// carries markers (the round-trip contract: sending a marker back
	// preserves the stored secret).
	updated := reqCtx.NewState()
	envsteps.RedactEnvironmentSecrets(updated)
	return updated, nil
}

// buildUpdatePipeline constructs the pipeline for environment update
func (c *EnvironmentController) buildUpdatePipeline() *pipeline.Pipeline[*environmentv1.Environment] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*environmentv1.Environment]("environment-update").
		AddStep(steps.NewValidateProtoStep[*environmentv1.Environment]()).                                         // 1. Validate field constraints
		AddStep(steps.NewValidateVisibilityStep[*environmentv1.Environment]()).                                    // Reject unsupported visibility levels (plain updates keep a request-carried level; Cloud guards this kind here too)
		AddStep(steps.NewResolveSlugStep[*environmentv1.Environment]()).                                           // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*environmentv1.Environment](c.store)).                                   // 3. Load existing environment
		AddStep(steps.NewBuildUpdateStateStep[*environmentv1.Environment]()).                                      // 4. Build updated state
		AddStep(envsteps.NewPreserveRedactedSecretsStep()).                                                        // 5. Preserve secrets when redaction marker sent back
		AddStep(envsteps.NewEncryptSecretValuesStep(c.secretService)).                                             // 6. Encrypt is_secret values (must follow the sentinel guard)
		AddStep(steps.NewNormalizeReferencesStep[*environmentv1.Environment]()).                                   // 7. Normalize cross-references
		AddStep(steps.NewPersistStep[*environmentv1.Environment](c.store)).                                        // 8. Persist environment
		AddStep(steps.NewIndexSearchStep[*environmentv1.Environment](c.store, &extractor.EnvironmentExtractor{})). // 9. Update search index
		Build()
}
