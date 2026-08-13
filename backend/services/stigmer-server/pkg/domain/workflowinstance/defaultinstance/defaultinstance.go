// Package defaultinstance builds the canonical WorkflowInstance request for
// per-workflow default instances — the workflow twin of the agentinstance
// defaultinstance package and the OSS twin of the cloud edition's
// DefaultWorkflowInstanceFactory. See the agentinstance package doc for the
// full rationale (naming single-sourcing, no visibility of their own,
// reserved-label markers vs the authoritative status.default_instance_id
// pointer); the two packages must stay in lockstep.
package defaultinstance

import (
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

const (
	apiVersion = "agentic.stigmer.ai/v1"
	kind       = "WorkflowInstance"

	slugSuffix  = "-default"
	description = "Default instance (auto-created, no custom configuration)"
)

// Slug resolves the deterministic slug of a workflow's default instance
// (<workflow-slug>-default) — the single source of the naming convention,
// used by workflow create and by workflow-execution create's self-heal
// lookup when a legacy workflow lacks status.default_instance_id.
func Slug(workflowSlug string) string {
	return workflowSlug + slugSuffix
}

// BuildRequest builds the WorkflowInstance proto for a default-instance
// creation request from the parent workflow's metadata. Callers hand it to
// the workflowinstance downstream client (Create/Apply AsSystem), which owns
// persistence and validation.
//
// Takes the metadata rather than loose strings for the same reason as the
// agentinstance twin: the instance is named from the workflow's SLUG (the
// identity Slug() reconstructs for fallback lookups), never the free-form
// display name — reading it at this single source makes the wrong-field
// mistake unwritable (stigmer/stigmer#355).
func BuildRequest(workflow *apiresourcepb.ApiResourceMetadata) *workflowinstancev1.WorkflowInstance {
	return &workflowinstancev1.WorkflowInstance{
		ApiVersion: apiVersion,
		Kind:       kind,
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: Slug(workflow.GetSlug()),
			Org:  workflow.GetOrg(),
			Labels: map[string]string{
				apiresource.DefaultInstanceLabel: apiresource.ReservedLabelTrue,
				apiresource.SystemManagedLabel:   apiresource.ReservedLabelTrue,
			},
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  workflow.GetId(),
			Description: description,
		},
	}
}
