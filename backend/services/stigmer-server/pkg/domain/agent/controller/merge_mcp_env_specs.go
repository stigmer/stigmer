package agent

import (
	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// mergeMcpServerEnvSpecsStep merges env_spec entries from referenced MCP servers
// into the agent's env_spec at create/update time.
//
// When an agent references MCP servers via mcp_server_usages, those servers may
// declare required environment variables in their env_spec. This step ensures the
// agent's env_spec includes those declarations so that:
//   - The UI/CLI can show what env vars the agent needs
//   - AgentInstance configuration knows which env vars to supply
//   - Execution-time validation has the complete schema to check against
//
// Merge semantics:
//   - Agent-declared entries always take precedence (user intent is preserved)
//   - Among MCP servers, first-encountered wins for overlapping keys
//   - Only schema fields (description, is_secret) are merged; value is left empty
//     because actual values come from AgentInstance.environment_refs at runtime
//
// This step is lenient: if an MCP server cannot be found (not yet created, different
// org, etc.), it logs a warning and continues. The authoritative fail-fast check
// remains McpEnvironmentValidator at execution creation time.
//
// Pipeline position: AFTER NormalizeReferences (needs resolved org), BEFORE Persist.
type mergeMcpServerEnvSpecsStep struct {
	store store.Store
}

func newMergeMcpServerEnvSpecsStep(s store.Store) *mergeMcpServerEnvSpecsStep {
	return &mergeMcpServerEnvSpecsStep{store: s}
}

func (s *mergeMcpServerEnvSpecsStep) Name() string {
	return "MergeMcpServerEnvSpecs"
}

func (s *mergeMcpServerEnvSpecsStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	agent := ctx.NewState()

	usages := agent.GetSpec().GetMcpServerUsages()
	if len(usages) == 0 {
		return nil
	}

	// Collect env vars from all referenced MCP servers (first-encountered wins)
	mcpEnvVars := make(map[string]*environmentv1.EnvironmentValue)
	for _, usage := range usages {
		ref := usage.GetMcpServerRef()

		slug := ref.GetSlug()
		if slug == "" {
			continue
		}

		org := ref.GetOrg()
		if org == "" {
			org = agent.GetMetadata().GetOrg()
		}
		if org == "" {
			continue
		}

		mcpServer, found, err := steps.FindResourceBySlug[*mcpserverv1.McpServer](
			ctx.Context(), s.store, apiresourcekind.ApiResourceKind_mcp_server, slug, org,
		)
		if err != nil {
			log.Warn().Err(err).
				Str("mcp_server_slug", slug).
				Str("org", org).
				Msg("Failed to look up MCP server for env_spec merge")
			continue
		}
		if !found {
			log.Warn().
				Str("mcp_server_slug", slug).
				Str("org", org).
				Msg("MCP server not found — skipping env_spec merge for this server")
			continue
		}

		serverEnvData := mcpServer.GetSpec().GetEnvSpec().GetData()
		if len(serverEnvData) == 0 {
			continue
		}

		for varName, varValue := range serverEnvData {
			if _, exists := mcpEnvVars[varName]; !exists {
				mcpEnvVars[varName] = &environmentv1.EnvironmentValue{
					Description: varValue.GetDescription(),
					IsSecret:    varValue.GetIsSecret(),
				}
			}
		}
	}

	if len(mcpEnvVars) == 0 {
		return nil
	}

	// Merge: agent-declared entries take precedence
	spec := agent.GetSpec()
	if spec == nil {
		return nil
	}

	envSpec := spec.GetEnvSpec()
	existingData := envSpec.GetData()

	merged := make(map[string]*environmentv1.EnvironmentValue, len(mcpEnvVars)+len(existingData))
	for k, v := range mcpEnvVars {
		merged[k] = v
	}
	for k, v := range existingData {
		merged[k] = v
	}

	if spec.EnvSpec == nil {
		spec.EnvSpec = &environmentv1.EnvironmentSpec{}
	}
	spec.EnvSpec.Data = merged

	mergedCount := len(merged) - len(existingData)
	if mergedCount > 0 {
		log.Info().
			Int("injected_count", mergedCount).
			Int("total_count", len(merged)).
			Str("agent", agent.GetMetadata().GetSlug()).
			Msg("Merged MCP server env vars into agent env_spec")
	}

	return nil
}
