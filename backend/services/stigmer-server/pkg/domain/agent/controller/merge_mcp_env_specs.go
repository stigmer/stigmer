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

// mergeMcpServerEnvSpecsStep merges env declarations from referenced MCP servers
// into the agent's env at create/update time.
//
// When an agent references MCP servers via mcp_server_usages, those servers may
// declare required environment variables in their env field. This step ensures the
// agent's env includes those declarations so that:
//   - The UI/CLI can show what env vars the agent needs
//   - AgentInstance configuration knows which env vars to supply
//   - Execution-time validation has the complete schema to check against
//
// Merge semantics:
//   - Agent-declared entries always take precedence (user intent is preserved)
//   - Among MCP servers, first-encountered wins for overlapping keys
//   - Only declaration fields (description, is_secret, optional) are merged;
//     actual values come from AgentInstance.environment_refs at runtime
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

	mcpEnvVars := make(map[string]*environmentv1.EnvVarDeclaration)
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
				Msg("Failed to look up MCP server for env merge")
			continue
		}
		if !found {
			log.Warn().
				Str("mcp_server_slug", slug).
				Str("org", org).
				Msg("MCP server not found — skipping env merge for this server")
			continue
		}

		serverEnv := mcpServer.GetSpec().GetEnv()
		if len(serverEnv) == 0 {
			continue
		}

		for varName, decl := range serverEnv {
			if _, exists := mcpEnvVars[varName]; !exists {
				mcpEnvVars[varName] = &environmentv1.EnvVarDeclaration{
					Description: decl.GetDescription(),
					IsSecret:    decl.GetIsSecret(),
					Optional:    decl.GetOptional(),
				}
			}
		}
	}

	if len(mcpEnvVars) == 0 {
		return nil
	}

	spec := agent.GetSpec()
	if spec == nil {
		return nil
	}

	existingEnv := spec.GetEnv()

	merged := make(map[string]*environmentv1.EnvVarDeclaration, len(mcpEnvVars)+len(existingEnv))
	for k, v := range mcpEnvVars {
		merged[k] = v
	}
	for k, v := range existingEnv {
		merged[k] = v
	}

	spec.Env = merged

	mergedCount := len(merged) - len(existingEnv)
	if mergedCount > 0 {
		log.Info().
			Int("injected_count", mergedCount).
			Int("total_count", len(merged)).
			Str("agent", agent.GetMetadata().GetSlug()).
			Msg("Merged MCP server env declarations into agent env")
	}

	return nil
}
