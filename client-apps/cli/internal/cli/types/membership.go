package types

import (
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// IsProjectMemberKind returns true if resources of this kind participate in
// project membership. Member kinds are tracked in Project.Spec.Members and
// are subject to reconciliation (including orphan deletion when pruning).
//
// Infrastructure kinds like Organization sit above Project in the resource
// hierarchy (Platform -> Organization -> Project -> Members) and are applied
// independently.
func IsProjectMemberKind(kind apiresourcekind.ApiResourceKind) bool {
	switch kind {
	case apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_mcp_server,
		apiresourcekind.ApiResourceKind_skill:
		return true
	default:
		return false
	}
}
