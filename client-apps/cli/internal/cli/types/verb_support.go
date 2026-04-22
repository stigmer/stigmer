package types

import (
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// verbSupport defines which verbs each kind supports.
// This is CLI-specific logic, not stored in proto.
//
// Verb support matrix:
//
//	| Kind         | apply | validate | get | list | delete | run | push | search | download |
//	|--------------|-------|----------|-----|------|--------|-----|------|--------|----------|
//	| Organization | Y     | -        | Y   | Y    | Y      | -   | -    | -      | -        |
//	| Agent        | Y     | Y        | Y   | Y    | Y      | Y   | -    | Y      | -        |
//	| Workflow     | Y     | Y        | Y   | Y    | Y      | Y   | -    | Y      | -        |
//	| Skill        | -     | -        | Y   | Y    | Y      | -   | Y    | -      | -        |
//	| McpServer    | Y     | Y        | Y   | Y    | Y      | -   | -    | -      | -        |
//	| Project      | Y*    | Y        | Y   | Y    | Y      | -   | -    | -      | -        |
//	| Runner       | Y     | -        | Y   | Y*** | -      | -   | -    | -      | -        |
//	| Execution    | -     | -        | Y   | Y    | Y**    | -   | -    | -      | Y        |
//
// *Project "apply" triggers SDK synthesis mode
// **Execution "delete" maps to cancel operation
// ***Runner "list" reads local state files (~/.stigmer/runners/), not the backend
//
// Note: agent_execution is special - it uses its own AgentExecutionQueryController RPCs,
// not the unified SearchService. It is included here for documentation and validation
// but is NOT added to cliRelevantKinds in registry.go.
var verbSupport = map[apiresourcekind.ApiResourceKind]map[Verb]bool{
	apiresourcekind.ApiResourceKind_organization: {
		VerbApply:  true,
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
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
	apiresourcekind.ApiResourceKind_api_key: {
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
	// agent_execution is special - uses dedicated AgentExecutionQueryController RPCs
	// not the unified SearchService. Handled as special case in commands.
	apiresourcekind.ApiResourceKind_agent_execution: {
		VerbGet:      true,
		VerbList:     true,
		VerbDelete:   true, // Maps to cancel operation
		VerbDownload: true,
	},
	apiresourcekind.ApiResourceKind_identity_provider: {
		VerbApply:  true,
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
	apiresourcekind.ApiResourceKind_oauth_app: {
		VerbApply:  true,
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
	apiresourcekind.ApiResourceKind_environment: {
		VerbApply:  true,
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
	apiresourcekind.ApiResourceKind_agent_instance: {
		VerbApply:  true,
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
	apiresourcekind.ApiResourceKind_workflow_instance: {
		VerbApply:  true,
		VerbGet:    true,
		VerbDelete: true,
		// No VerbList: proto has getByWorkflow (requires workflow_id), not a generic list RPC
	},
	apiresourcekind.ApiResourceKind_session: {
		VerbApply:  true,
		VerbGet:    true,
		VerbList:   true,
		VerbDelete: true,
	},
	apiresourcekind.ApiResourceKind_runner: {
		VerbApply: true,
		VerbGet:   true,
		VerbList:  true,
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
