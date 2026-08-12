package environment

import (
	"context"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	domainSteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new environment using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. CheckDuplicate - Verify no duplicate exists (slug-level)
// 4. EnforcePersonalEnvUniqueness - At most one personal env per org
// 5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event), default visibility
// 6. PreserveRedactedSecrets - Reject secret sentinels (redaction marker, enc:v<N>: prefix)
// 7. EncryptSecretValues - Encrypt is_secret values at rest (sentinels → encrypt ordering)
// 8. Persist - Save environment to repository
// 9. IndexSearch - Update search index
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *EnvironmentController) Create(ctx context.Context, environment *environmentv1.Environment) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, environment)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Redact AFTER persist: the store keeps ciphertext, the response
	// carries markers (never ciphertext — clients cannot round-trip it
	// past the enc: prefix guard, and it is server-internal by design).
	created := reqCtx.NewState()
	domainSteps.RedactEnvironmentSecrets(created)
	return created, nil
}

// buildCreatePipeline constructs the pipeline for environment creation
func (c *EnvironmentController) buildCreatePipeline() *pipeline.Pipeline[*environmentv1.Environment] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*environmentv1.Environment]("environment-create").
		AddStep(steps.NewValidateProtoStep[*environmentv1.Environment]()).                                         // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*environmentv1.Environment]()).                                           // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*environmentv1.Environment](c.store)).                                 // 3. Check duplicate
		AddStep(domainSteps.NewEnforcePersonalUniquenessStep(c.store)).                                            // 4. At most one personal env per org
		AddStep(steps.NewBuildNewStateStep[*environmentv1.Environment]()).                                         // 5. Build new state
		AddStep(domainSteps.NewPreserveRedactedSecretsStep()).                                                     // 6. Reject secret sentinels (no existing resource: marker and enc: prefix both refused)
		AddStep(domainSteps.NewEncryptSecretValuesStep(c.secretService)).                                          // 7. Encrypt is_secret values (must follow the sentinel guard)
		AddStep(steps.NewPersistStep[*environmentv1.Environment](c.store)).                                        // 8. Persist environment
		AddStep(steps.NewIndexSearchStep[*environmentv1.Environment](c.store, &extractor.EnvironmentExtractor{})). // 9. Update search index
		Build()
}
