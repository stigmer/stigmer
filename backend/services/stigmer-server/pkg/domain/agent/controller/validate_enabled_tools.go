package agent

import (
	"fmt"
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/enabledtools"
)

// validateEnabledToolsStep rejects agent manifests whose
// McpServerUsage.enabled_tools name tools the referenced MCP server does not
// expose (issue #402).
//
// Runtime enforcement (runner shared/mcp-enabled-tools.ts, issue #350) is
// deliberately lenient: an unknown name is warned in the runner log and
// dropped, so a manifest typo silently narrows the agent's toolset. This step
// is the apply-time half of that owner decision — reject the typo where the
// operator can see it, with the server's real tool names in the error.
//
// Deliberate skips:
//   - Usages with an empty enabled_tools list: empty means "use the server's
//     default_enabled_tools" — nothing to check here.
//   - Referenced server not found: ValidateReferencesStep, earlier in the
//     pipeline, already rejects missing references with its own actionable
//     error; re-reporting here would only shadow it.
//   - Server without discovered_capabilities: the server has not been
//     connected yet (capabilities arrive via the connect RPC or the
//     post-apply best-effort connect), so there is no authoritative toolset
//     to validate against. The runner's warn-and-intersect remains the safety
//     net for that window.
//
// Pipeline position: AFTER ValidateReferences (missing-reference errors take
// precedence, and NormalizeReferences has resolved relative orgs), BEFORE
// Persist.
type validateEnabledToolsStep struct {
	store store.Store
}

func newValidateEnabledToolsStep(s store.Store) *validateEnabledToolsStep {
	return &validateEnabledToolsStep{store: s}
}

func (s *validateEnabledToolsStep) Name() string {
	return "ValidateEnabledTools"
}

func (s *validateEnabledToolsStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	agent := ctx.NewState()

	for _, usage := range agent.GetSpec().GetMcpServerUsages() {
		if len(usage.GetEnabledTools()) == 0 {
			continue
		}

		ref := usage.GetMcpServerRef()
		slug := ref.GetSlug()
		if slug == "" {
			continue
		}
		org := ref.GetOrg()
		if org == "" {
			org = agent.GetMetadata().GetOrg()
		}

		mcpServer, found, err := steps.FindResourceBySlug[*mcpserverv1.McpServer](
			ctx.Context(), s.store, apiresourcekind.ApiResourceKind_mcp_server, slug, org,
		)
		if err != nil {
			return fmt.Errorf("failed to look up MCP server '%s' (org: %s) for enabled_tools validation: %w", slug, org, err)
		}
		if !found {
			continue
		}

		caps := mcpServer.GetStatus().GetDiscoveredCapabilities()
		if caps == nil {
			continue
		}

		classification := enabledtools.Classify(caps, usage.GetEnabledTools())
		if !classification.Valid() {
			return invalidEnabledToolsError(slug, org, classification, caps)
		}
	}

	return nil
}

// invalidEnabledToolsError builds the operator-facing INVALID_ARGUMENT error.
// It names the offending entries, distinguishes resource-template names from
// plain typos, and lists the discovered tool names so the fix is one edit
// away. The refresh hint covers the honest failure mode where the server's
// toolset changed after the last discovery.
func invalidEnabledToolsError(slug, org string, c enabledtools.Classification, caps *mcpserverv1.DiscoveredCapabilities) error {
	var problems []string
	if len(c.Unknown) > 0 {
		problems = append(problems, fmt.Sprintf(
			"enabled_tools names tool(s) the server does not expose: %s",
			enabledtools.QuoteJoin(c.Unknown),
		))
	}
	if len(c.ResourceTemplates) > 0 {
		problems = append(problems, fmt.Sprintf(
			"enabled_tools names resource template(s): %s — resource templates are read-only data endpoints, not callable tools, and must not appear in enabled_tools",
			enabledtools.QuoteJoin(c.ResourceTemplates),
		))
	}

	return grpclib.InvalidArgumentError(
		"MCP server '%s' (org: %s): %s. Discovered tools: %s. "+
			"If the server's toolset changed, run 'stigmer connect' on it to refresh discovered capabilities.",
		slug, org, strings.Join(problems, "; "), enabledtools.QuoteJoin(enabledtools.ToolNames(caps)),
	)
}
