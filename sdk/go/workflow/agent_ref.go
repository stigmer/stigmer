package workflow

import (
	"strings"

	"github.com/stigmer/stigmer/sdk/go/agent"
)

// AgentRef represents a reference to an agent using the org/slug model.
//
// AgentRef enables workflows to reference agents either by direct instance
// or by org/slug string. All resources belong to an organization and are
// referenced using the "org/slug" format.
//
// Example:
//
//	// Reference agent by instance
//	ref := workflow.Agent(myAgent)
//
//	// Reference agent by org/slug
//	ref := workflow.AgentBySlug("stigmer/code-reviewer")
//
//	// Reference agent with explicit org and slug
//	ref := workflow.AgentByOrgSlug("stigmer", "code-reviewer")
type AgentRef struct {
	// org is the organization that owns this agent
	org string

	// slug is the agent's unique identifier within the organization
	slug string
}

// Agent creates an AgentRef from an agent instance.
// This is the Pulumi-style reference pattern.
//
// Example:
//
//	reviewer, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	    Instructions: "Review code",
//	})
//	ref := workflow.Agent(reviewer)
func Agent(a *agent.Agent) AgentRef {
	return AgentRef{
		org:  a.Org,
		slug: a.Slug,
	}
}

// AgentBySlug creates an AgentRef from an "org/slug" string.
//
// The ref parameter should be in the format "org/slug" (e.g., "stigmer/code-reviewer").
//
// Example:
//
//	// Reference a public agent from stigmer org
//	ref := workflow.AgentBySlug("stigmer/code-reviewer")
//
//	// Reference an agent from your organization
//	ref := workflow.AgentBySlug("my-org/my-agent")
func AgentBySlug(ref string) AgentRef {
	org, slug := parseOrgSlug(ref)
	return AgentRef{
		org:  org,
		slug: slug,
	}
}

// AgentByOrgSlug creates an AgentRef with explicit org and slug.
//
// Example:
//
//	ref := workflow.AgentByOrgSlug("stigmer", "code-reviewer")
func AgentByOrgSlug(org, slug string) AgentRef {
	return AgentRef{
		org:  org,
		slug: slug,
	}
}

// Org returns the organization that owns this agent.
func (r AgentRef) Org() string {
	return r.org
}

// Slug returns the agent slug.
func (r AgentRef) Slug() string {
	return r.slug
}

// Ref returns the full reference string in "org/slug" format.
func (r AgentRef) Ref() string {
	if r.org == "" {
		return r.slug
	}
	return r.org + "/" + r.slug
}

// parseOrgSlug parses an "org/slug" string into org and slug components.
// If no "/" is present, the entire string is treated as the slug with empty org.
func parseOrgSlug(ref string) (org, slug string) {
	if idx := strings.Index(ref, "/"); idx > 0 {
		return ref[:idx], ref[idx+1:]
	}
	return "", ref
}
