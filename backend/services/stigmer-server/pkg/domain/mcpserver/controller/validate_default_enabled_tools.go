package mcpserver

import (
	"fmt"
	"strings"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/enabledtools"
)

// validateDefaultEnabledToolsStep rejects updates whose
// spec.default_enabled_tools name tools this server does not expose
// (issue #402, the mcpserver twin of the agent controller's
// validateEnabledToolsStep).
//
// The check is self-referential — spec against the resource's OWN stored
// discovered_capabilities — so it needs no store fetch: BuildUpdateStateStep
// has already copied the existing status (including capabilities) onto the
// merged state this step reads.
//
// Wired into the UPDATE pipeline only. On create the resource cannot have a
// status yet (the first discovery is the post-apply best-effort connect), so
// a create-side check would be a no-op by construction; leaving it unwired
// keeps the create pipeline honest about what it enforces.
//
// Deliberate skips:
//   - Empty default_enabled_tools: empty means "all tools enabled" — nothing
//     to check.
//   - No discovered_capabilities yet: the server has never been connected,
//     so there is no authoritative toolset to validate against. The runner's
//     warn-and-intersect (issue #350) remains the safety net for that window.
type validateDefaultEnabledToolsStep struct{}

func newValidateDefaultEnabledToolsStep() *validateDefaultEnabledToolsStep {
	return &validateDefaultEnabledToolsStep{}
}

func (s *validateDefaultEnabledToolsStep) Name() string {
	return "ValidateDefaultEnabledTools"
}

func (s *validateDefaultEnabledToolsStep) Execute(ctx *pipeline.RequestContext[*mcpserverv1.McpServer]) error {
	mcpServer := ctx.NewState()

	requested := mcpServer.GetSpec().GetDefaultEnabledTools()
	if len(requested) == 0 {
		return nil
	}

	caps := mcpServer.GetStatus().GetDiscoveredCapabilities()
	if caps == nil {
		return nil
	}

	classification := enabledtools.Classify(caps, requested)
	if classification.Valid() {
		return nil
	}

	var problems []string
	if len(classification.Unknown) > 0 {
		problems = append(problems, fmt.Sprintf(
			"default_enabled_tools names tool(s) this server does not expose: %s",
			enabledtools.QuoteJoin(classification.Unknown),
		))
	}
	if len(classification.ResourceTemplates) > 0 {
		problems = append(problems, fmt.Sprintf(
			"default_enabled_tools names resource template(s): %s — resource templates are read-only data endpoints, not callable tools, and must not appear in default_enabled_tools",
			enabledtools.QuoteJoin(classification.ResourceTemplates),
		))
	}

	return grpclib.InvalidArgumentError(
		"MCP server '%s': %s. Discovered tools: %s. "+
			"If the server's toolset changed, run 'stigmer connect' on it to refresh discovered capabilities.",
		mcpServer.GetMetadata().GetSlug(), strings.Join(problems, "; "),
		enabledtools.QuoteJoin(enabledtools.ToolNames(caps)),
	)
}
