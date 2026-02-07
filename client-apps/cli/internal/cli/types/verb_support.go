package types

import (
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// verbSupport defines which verbs each kind supports.
// This is CLI-specific logic, not stored in proto.
//
// Verb support matrix:
//
//	| Kind      | apply | validate | get | list | delete | run | push | search |
//	|-----------|-------|----------|-----|------|--------|-----|------|--------|
//	| Agent     | Y     | Y        | Y   | Y    | Y      | Y   | -    | Y      |
//	| Workflow  | Y     | Y        | Y   | Y    | Y      | Y   | -    | Y      |
//	| Skill     | -     | -        | Y   | Y    | Y      | -   | Y    | -      |
//	| McpServer | Y     | Y        | Y   | Y    | Y      | -   | -    | -      |
//	| Project   | Y*    | Y        | Y   | Y    | Y      | -   | -    | -      |
//
// *Project "apply" triggers SDK synthesis mode
var verbSupport = map[apiresourcekind.ApiResourceKind]map[Verb]bool{
	apiresourcekind.ApiResourceKind_agent: {
		VerbApply:    true,
		VerbValidate: true,
		VerbGet:      true,
		VerbList:     true,
		VerbDelete:   true,
		VerbRun:      true,
		VerbSearch:   true,
	},
	apiresourcekind.ApiResourceKind_workflow: {
		VerbApply:    true,
		VerbValidate: true,
		VerbGet:      true,
		VerbList:     true,
		VerbDelete:   true,
		VerbRun:      true,
		VerbSearch:   true,
	},
	apiresourcekind.ApiResourceKind_skill: {
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
		VerbPush:   true,
	},
	apiresourcekind.ApiResourceKind_mcp_server: {
		VerbApply:    true,
		VerbValidate: true,
		VerbGet:      true,
		VerbList:     true,
		VerbDelete:   true,
	},
	apiresourcekind.ApiResourceKind_project: {
		VerbApply:    true, // Triggers SDK synthesis mode
		VerbValidate: true,
		VerbGet:      true,
		VerbList:     true,
		VerbDelete:   true,
	},
}

// GetVerbSupport returns the verb support map for a kind.
// Returns nil if the kind is not a CLI-relevant kind.
func GetVerbSupport(kind apiresourcekind.ApiResourceKind) map[Verb]bool {
	support, ok := verbSupport[kind]
	if !ok {
		return nil
	}
	// Return a copy to prevent mutation
	result := make(map[Verb]bool, len(support))
	for k, v := range support {
		result[k] = v
	}
	return result
}

// SupportsVerb checks if a kind supports a specific verb.
func SupportsVerb(kind apiresourcekind.ApiResourceKind, verb Verb) bool {
	support, ok := verbSupport[kind]
	if !ok {
		return false
	}
	return support[verb]
}

// KindsForVerb returns all kinds that support a given verb.
func KindsForVerb(verb Verb) []apiresourcekind.ApiResourceKind {
	var kinds []apiresourcekind.ApiResourceKind
	for kind, support := range verbSupport {
		if support[verb] {
			kinds = append(kinds, kind)
		}
	}
	return kinds
}
