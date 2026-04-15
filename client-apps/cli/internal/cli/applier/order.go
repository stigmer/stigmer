package applier

import (
	"sort"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// DefaultApplyOrder defines the apply priority for resource kinds.
// Resources are applied in ascending order of priority value so that
// dependencies are created before the resources that reference them.
//
// Dependency graph:
//
//	Organization (0) <- MCP Server (1) <- Agent (2) <- Workflow (3)
//
// Kinds absent from this map receive priority 99 (applied last).
var DefaultApplyOrder = map[apiresourcekind.ApiResourceKind]int{
	apiresourcekind.ApiResourceKind_organization: 0,
	apiresourcekind.ApiResourceKind_mcp_server:   1,
	apiresourcekind.ApiResourceKind_agent:        2,
	apiresourcekind.ApiResourceKind_workflow:     3,
}

// SortByApplyOrder sorts items in dependency order using the provided priority
// function. Items of the same priority retain their original relative order.
func SortByApplyOrder[T any](items []T, priority func(T) apiresourcekind.ApiResourceKind) {
	sort.SliceStable(items, func(i, j int) bool {
		return applyPriority(priority(items[i])) < applyPriority(priority(items[j]))
	})
}

func applyPriority(kind apiresourcekind.ApiResourceKind) int {
	if p, ok := DefaultApplyOrder[kind]; ok {
		return p
	}
	return 99
}
