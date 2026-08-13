package executioncontext

import (
	"context"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new execution context using the pipeline framework
//
// ExecutionContext is an operator-only, platform-scoped resource that:
// - Contains ephemeral runtime configuration and secrets
// - Is created by the execution engine at execution start
// - Is deleted when execution completes
// - Is only accessible by platform operators
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints (including owner_scope restriction)
// 2. RejectCiphertextShapedValues - Refuse client-supplied enc:v<N>: input (oss#535)
// 3. ResolveSlug - Generate slug from metadata.name
// 4. CheckDuplicate - Verify no duplicate exists by slug
// 5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event), default visibility
// 6. EncryptSecretValues - Encrypt is_secret values before storage (oss#535)
// 7. Persist - Save execution context to repository
//
// The response echo is redacted after the pipeline: the persisted resource
// is echoed back to the caller, and without redaction the echo would leak
// either the plaintext the caller just sent or the stored ciphertext. The
// internal builders (agent execution, workflow execution, MCP connect) only
// read metadata.id from the echo, so they are unaffected.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *ExecutionContextController) Create(ctx context.Context, executionContext *executioncontextv1.ExecutionContext) (*executioncontextv1.ExecutionContext, error) {
	reqCtx := pipeline.NewRequestContext(ctx, executionContext)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	created := reqCtx.NewState()
	RedactExecutionContextSecrets(created)
	return created, nil
}

// buildCreatePipeline constructs the pipeline for execution context creation
func (c *ExecutionContextController) buildCreatePipeline() *pipeline.Pipeline[*executioncontextv1.ExecutionContext] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*executioncontextv1.ExecutionContext]("execution-context-create").
		AddStep(steps.NewValidateProtoStep[*executioncontextv1.ExecutionContext]()).                                              // 1. Validate field constraints
		AddStep(steps.NewValidateVisibilityStep[*executioncontextv1.ExecutionContext]()).                                         // Reject unsupported visibility levels (fail fast)
		AddStep(newRejectCiphertextShapedStep()).                                                                                 // 2. Refuse forged ciphertext input
		AddStep(steps.NewResolveSlugStep[*executioncontextv1.ExecutionContext]()).                                                // 3. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*executioncontextv1.ExecutionContext](c.store)).                                      // 4. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*executioncontextv1.ExecutionContext]()).                                              // 5. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*executioncontextv1.ExecutionContext]()).                                        // 6. Normalize cross-references
		AddStep(newEncryptSecretValuesStep(c.secretService)).                                                                     // 7. Encrypt secrets before storage
		AddStep(steps.NewPersistStep[*executioncontextv1.ExecutionContext](c.store)).                                             // 8. Persist
		AddStep(steps.NewIndexSearchStep[*executioncontextv1.ExecutionContext](c.store, &extractor.ExecutionContextExtractor{})). // 9. Update search index (metadata only)
		Build()
}
