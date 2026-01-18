package workflow

import "github.com/stigmer/stigmer/sdk/go/agent"

// AgentRef represents a reference to an agent (Pulumi-style).
//
// AgentRef enables workflows to reference agents either by direct instance
// or by slug with optional scope specification.
//
// Example:
//
//	// Reference agent by instance
//	ref := workflow.Agent(myAgent)
//
//	// Reference agent by slug (organization scope assumed)
//	ref := workflow.AgentBySlug("code-reviewer")
//
//	// Reference agent by slug with explicit scope
//	ref := workflow.AgentBySlug("code-reviewer", "platform")
type AgentRef struct {
	// Agent slug (name)
	slug string

	// Scope (platform or organization) - optional
	// Empty means unspecified, will default to organization at runtime
	scope string
}

// Agent creates an AgentRef from an agent instance.
// This is the Pulumi-style reference pattern.
//
// Example:
//
//	reviewer, _ := agent.New(ctx,
//	    agent.WithName("code-reviewer"),
//	    agent.WithInstructions("Review code"),
//	)
//	ref := workflow.Agent(reviewer)
func Agent(a *agent.Agent) AgentRef {
	return AgentRef{
		slug:  a.Name,
		scope: determineScope(a),
	}
}

// AgentBySlug creates an AgentRef by slug with optional scope.
//
// If scope is not provided, it defaults to organization scope at runtime.
//
// Valid scopes:
//   - "platform" - Public agents available to all organizations
//   - "organization" - Private agents in current organization
//
// Example:
//
//	// Organization scope (default)
//	ref := workflow.AgentBySlug("code-reviewer")
//
//	// Platform scope (public agent)
//	ref := workflow.AgentBySlug("code-reviewer", "platform")
func AgentBySlug(slug string, scope ...string) AgentRef {
	ref := AgentRef{slug: slug}
	if len(scope) > 0 {
		ref.scope = scope[0]
	}
	return ref
}

// Slug returns the agent slug.
func (r AgentRef) Slug() string {
	return r.slug
}

// Scope returns the agent scope (platform or organization).
// Empty string means unspecified (defaults to organization at runtime).
func (r AgentRef) Scope() string {
	return r.scope
}

// determineScope infers scope from agent configuration.
//
// Logic:
//   - If agent has Org set, it's organization-scoped
//   - If agent has no Org, assume platform-scoped (public agent)
func determineScope(a *agent.Agent) string {
	// If org is set, it's organization-scoped (private to that org)
	if a.Org != "" {
		return "organization"
	}
	// Otherwise assume platform-scoped (public agent)
	return "platform"
}
