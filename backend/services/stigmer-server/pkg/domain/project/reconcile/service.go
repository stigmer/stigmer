package reconcile

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// reconciliationServiceImpl implements ReconciliationService.
//
// It compares previous and current membership lists, computes the set difference,
// and deletes orphaned resources when pruning is enabled.
type reconciliationServiceImpl struct {
	store   store.Store
	deleter ResourceDeleter
}

// NewReconciliationService creates a new ReconciliationService.
//
// Parameters:
//   - store: Used to resolve ApiResourceReference to resource ID for deletion
//   - deleter: Deletes orphaned resources (optional; pass nil for stub/test mode)
func NewReconciliationService(store store.Store, deleter ResourceDeleter) ReconciliationService {
	return &reconciliationServiceImpl{
		store:   store,
		deleter: deleter,
	}
}

// Reconcile compares previous and current membership lists, computes added/removed
// members, and optionally deletes orphaned resources.
func (s *reconciliationServiceImpl) Reconcile(
	ctx context.Context,
	previousMembers []*apiresource.ApiResourceReference,
	currentMembers []*apiresource.ApiResourceReference,
	options *ReconciliationOptions,
) (*ReconciliationResult, error) {
	if options == nil {
		options = DefaultOptions()
	}

	previousSet := buildReferenceSet(previousMembers)
	currentSet := buildReferenceSet(currentMembers)

	added := computeAdded(currentMembers, previousSet)
	orphans := computeOrphans(previousMembers, currentSet)

	if len(added) == 0 && len(orphans) == 0 {
		return EmptyResult(), nil
	}

	if options.IsDryRun() {
		return NewResult(added, orphans, nil), nil
	}

	if !options.IsPruneEnabled() || len(orphans) == 0 {
		return NewResult(added, nil, nil), nil
	}

	removed, errors := s.deleteOrphans(ctx, orphans)

	return NewResult(added, removed, errors), nil
}

// deleteOrphans attempts to delete each orphaned resource, continuing on failure.
//
// Returns the successfully deleted references and any errors encountered.
func (s *reconciliationServiceImpl) deleteOrphans(
	ctx context.Context,
	orphans []*apiresource.ApiResourceReference,
) ([]*apiresource.ApiResourceReference, []ReconciliationError) {
	var removed []*apiresource.ApiResourceReference
	var errors []ReconciliationError

	for _, ref := range orphans {
		refKey := referenceKey(ref)

		resourceID, err := s.resolveResourceID(ctx, ref)
		if err != nil {
			errors = append(errors, NewReconciliationErrorWithCause(
				refKey, "failed to resolve resource for deletion", err,
			))
			continue
		}

		if s.deleter == nil {
			removed = append(removed, ref)
			continue
		}

		if err := s.deleter.Delete(ctx, ref.GetKind(), resourceID); err != nil {
			errors = append(errors, NewReconciliationErrorWithCause(
				refKey, "failed to delete orphaned resource", err,
			))
			continue
		}

		removed = append(removed, ref)
	}

	return removed, errors
}

// resolveResourceID looks up a resource by kind and slug to obtain its ID.
func (s *reconciliationServiceImpl) resolveResourceID(
	ctx context.Context,
	ref *apiresource.ApiResourceReference,
) (string, error) {
	kind := ref.GetKind()
	slug := ref.GetSlug()

	msg, err := newProtoForKind(kind)
	if err != nil {
		return "", err
	}

	if err := s.store.FindByField(ctx, kind, "metadata.slug", slug, msg); err != nil {
		return "", fmt.Errorf("resource %s/%s not found: %w", kind, slug, err)
	}

	metaResource, ok := msg.(steps.HasMetadata)
	if !ok {
		return "", fmt.Errorf("resource %s/%s does not implement HasMetadata", kind, slug)
	}

	metadata := metaResource.GetMetadata()
	if metadata == nil || metadata.Id == "" {
		return "", fmt.Errorf("resource %s/%s has no ID", kind, slug)
	}

	return metadata.Id, nil
}

// newProtoForKind creates an empty proto message for the given resource kind.
func newProtoForKind(kind apiresourcekind.ApiResourceKind) (proto.Message, error) {
	switch kind {
	case apiresourcekind.ApiResourceKind_agent:
		return &agentv1.Agent{}, nil
	case apiresourcekind.ApiResourceKind_workflow:
		return &workflowv1.Workflow{}, nil
	case apiresourcekind.ApiResourceKind_mcp_server:
		return &mcpserverv1.McpServer{}, nil
	case apiresourcekind.ApiResourceKind_skill:
		return &skillv1.Skill{}, nil
	default:
		return nil, fmt.Errorf("unsupported resource kind: %v", kind)
	}
}

// referenceKey produces a stable string key from an ApiResourceReference
// for use in error messages and set operations.
//
// Format: "{kind}:{slug}" (e.g., "agent:my-agent").
func referenceKey(ref *apiresource.ApiResourceReference) string {
	return fmt.Sprintf("%s:%s", ref.GetKind(), ref.GetSlug())
}

// buildReferenceSet builds a set of reference keys for O(1) membership checks.
func buildReferenceSet(refs []*apiresource.ApiResourceReference) map[string]struct{} {
	set := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		set[referenceKey(ref)] = struct{}{}
	}
	return set
}

// computeAdded returns references in current that are not in the previous set.
func computeAdded(
	current []*apiresource.ApiResourceReference,
	previousSet map[string]struct{},
) []*apiresource.ApiResourceReference {
	var added []*apiresource.ApiResourceReference
	for _, ref := range current {
		if _, exists := previousSet[referenceKey(ref)]; !exists {
			added = append(added, ref)
		}
	}
	return added
}

// computeOrphans returns references in previous that are not in the current set.
func computeOrphans(
	previous []*apiresource.ApiResourceReference,
	currentSet map[string]struct{},
) []*apiresource.ApiResourceReference {
	var orphans []*apiresource.ApiResourceReference
	for _, ref := range previous {
		if _, exists := currentSet[referenceKey(ref)]; !exists {
			orphans = append(orphans, ref)
		}
	}
	return orphans
}
