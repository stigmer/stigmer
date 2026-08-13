package steps

import (
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
)

// ValidateVisibilityStep rejects visibility levels the resource kind does not
// support — fail-fast, before any state is built or persisted.
//
// The requested level (metadata.visibility on the request) is checked against
// the kind's proto VisibilityConfig via apiresource.SupportsVisibility;
// PRIVATE and UNSPECIFIED are always valid (they carry no visibility grant).
// Unsupported levels fail with INVALID_ARGUMENT and the same message the
// cloud edition emits, so clients see one contract across editions.
//
// Without this validation, an unsupported level persists verbatim (e.g. an
// agent_instance claiming visibility_platform — a level instances never
// support, for tenant isolation), producing states the cloud edition treats
// as invalid and breaking cross-edition data portability.
//
// This is the Go analog of Cloud's ValidateVisibilityStep, wired the same
// way: into every create pipeline immediately after proto-constraint
// validation (before slug resolution and the duplicate check, so a request
// that is wrong in multiple ways reports INVALID_ARGUMENT on both editions).
// It is create-only: plain updates preserve the stored visibility
// unconditionally (see preserveImmutableFields, oss#573), so there is no
// update-side level to validate — updateVisibility is the only door, and
// ValidateVisibilityUpdateStep guards it.
//
// Deliberate divergences from the cloud step, and why:
//   - No platform-anchor check (Cloud additionally requires the owning org to
//     operate an IdentityProvider before granting PLATFORM). OSS has no
//     IdentityProvider domain, so there is nothing to anchor to — the level
//     check alone is the whole OSS contract.
//   - Skill push is not wired. Skills are created by the push flow (no create
//     pipeline); Cloud's SkillPushHandler does not validate visibility either,
//     and skills are a blueprint kind supporting every level, so a check
//     there would be dead code diverging from Cloud. Do not "fix" this.
//
// This step reads the visibility from the request's embedded metadata, so it
// only works for pipelines whose request IS the resource (create/update).
// UpdateVisibility RPCs take an UpdateVisibilityInput (no metadata); they
// validate via ValidateVisibilityUpdateStep instead.
//
// The api_resource_kind is extracted from request context (injected by the
// apiresource interceptor).
type ValidateVisibilityStep[T proto.Message] struct {
}

// NewValidateVisibilityStep creates a new ValidateVisibilityStep.
func NewValidateVisibilityStep[T proto.Message]() *ValidateVisibilityStep[T] {
	return &ValidateVisibilityStep[T]{}
}

// Name returns the step name for logging and tracing.
func (s *ValidateVisibilityStep[T]) Name() string {
	return "ValidateVisibility"
}

// Execute rejects the request when it asks for a visibility level the kind
// does not support.
func (s *ValidateVisibilityStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource, ok := any(ctx.Input()).(HasMetadata)
	if !ok {
		// No metadata to validate — other steps own that failure mode.
		return nil
	}
	metadata := resource.GetMetadata()
	if metadata == nil {
		return nil
	}

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	return rejectUnsupportedVisibility(kind, metadata.GetVisibility())
}

// ValidateVisibilityUpdateStep is the counterpart of ValidateVisibilityStep
// for UpdateVisibility pipelines — their request is an UpdateVisibilityInput
// (resource_id + visibility, no metadata), so the create-side step would be
// a silent no-op there.
//
// It validates the requested level against the kind's proto VisibilityConfig,
// exactly like the create-side step, and emits the same cloud-identical
// INVALID_ARGUMENT on rejection. The Go analog of Cloud's
// ValidateVisibilityUpdateStep.
//
// Place it AFTER the handler's load step: the step itself does not need the
// loaded target, but validating after the load preserves the cross-edition
// error precedence — an unknown resource_id with a bad level returns
// NOT_FOUND (not INVALID_ARGUMENT) on both editions, because Cloud's step
// needs the loaded target and therefore runs after its load.
//
// Deliberate divergence from the cloud step: the default-instance guard is
// NOT here. Cloud folds it into this step (label check on the loaded
// target), but the Go pipelines keep each handler's loaded target under a
// domain-local context key this shared step cannot reach, and the OSS guard
// additionally needs a kind-specific parent lookup (see
// RejectDefaultInstanceVisibilityUpdate). The guard therefore lives as a
// domain step in the two instance controllers (agentinstance,
// workflowinstance), placed BEFORE this step to preserve cloud's error
// precedence: a default instance with a bad level returns FAILED_PRECONDITION
// (not INVALID_ARGUMENT) on both editions.
type ValidateVisibilityUpdateStep struct {
}

// NewValidateVisibilityUpdateStep creates a new ValidateVisibilityUpdateStep.
func NewValidateVisibilityUpdateStep() *ValidateVisibilityUpdateStep {
	return &ValidateVisibilityUpdateStep{}
}

// Name returns the step name for logging and tracing.
func (s *ValidateVisibilityUpdateStep) Name() string {
	return "ValidateVisibilityUpdate"
}

// Execute rejects the update when it asks for a visibility level the kind
// does not support.
func (s *ValidateVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	return rejectUnsupportedVisibility(kind, ctx.Input().GetVisibility())
}

// RejectDefaultInstanceVisibilityUpdate is the canonical rejection for a
// visibility update aimed at a system-managed default instance:
// FAILED_PRECONDITION with the exact message the cloud edition's
// ValidateVisibilityUpdateStep emits, so clients see one contract across
// editions (the text is pinned by the conformance suite).
//
// Default instances carry no visibility of their own — their access always
// follows the parent blueprint (on cloud via the default_of FGA relation;
// on OSS by construction, since the runner resolves the default instance
// through the blueprint). A level stamped here would create state the cloud
// edition considers structurally invalid, breaking cross-edition data
// portability.
//
// The PREDICATE deciding "is this a default instance" is deliberately not
// shared: it needs the domain's loaded target and a kind-specific parent
// lookup, so it lives in the instance controllers' guard steps. Only the
// contract (code + message) is centralized here, next to its level-check
// sibling, so the two domains cannot drift apart.
func RejectDefaultInstanceVisibilityUpdate() error {
	return grpclib.FailedPreconditionError(
		"Default instances do not have their own visibility - access always follows " +
			"the parent blueprint. Change the blueprint's visibility instead.")
}

// rejectUnsupportedVisibility is the shared rejection: nil when the kind
// supports the level, INVALID_ARGUMENT (cloud-identical message) when it
// does not, INTERNAL when the kind's visibility config cannot be resolved.
func rejectUnsupportedVisibility(
	kind apiresourcekind.ApiResourceKind,
	visibility apiresourcepb.ApiResourceVisibility,
) error {
	supported, err := apiresource.SupportsVisibility(kind, visibility)
	if err != nil {
		return grpclib.InternalError(err, "failed to resolve visibility config from kind")
	}
	if supported {
		return nil
	}

	levels, err := apiresource.SupportedVisibilityLevels(kind)
	if err != nil {
		return grpclib.InternalError(err, "failed to resolve visibility config from kind")
	}
	return grpclib.InvalidArgumentError(
		"%s resources cannot be set to %s. Supported visibility levels: %s.",
		kind.String(), visibility.String(), levels)
}
