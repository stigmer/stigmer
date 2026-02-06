package agent

import (
	"sync"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	genAgent "github.com/stigmer/stigmer/sdk/go/gen/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

// AgentArgs is an alias for the generated AgentArgs from gen/agent.
// This provides a single source of truth for agent configuration.
type AgentArgs = genAgent.AgentArgs

// Context is a minimal interface that represents a stigmer context.
// This allows the agent package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	RegisterAgent(*Agent)
}

// Agent represents an AI agent template with skills, MCP servers, and configuration.
//
// Agent uses the COMPOSITION pattern - it embeds Args rather than duplicating its fields.
// This provides a single source of truth for configuration and reduces maintenance burden.
//
// The Agent is the "template" layer - it defines the immutable logic and requirements
// for an agent. Actual configuration with secrets happens at the AgentInstance level.
//
// Use agent.New() with stigmer.Run() to create an Agent:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	        Instructions: "Review code and suggest improvements",
//	    })
//	    return err
//	})
type Agent struct {
	// Name is the agent name (lowercase alphanumeric with hyphens, max 63 chars).
	// This is an identity field, not part of Args.
	Name string

	// Slug is the URL-friendly identifier (auto-generated from name if not provided).
	// This is an identity field, not part of Args.
	Slug string

	// Org is the organization that owns this agent (optional).
	// This is metadata, not part of Args.
	Org string

	// Args contains all configuration for this agent.
	// This is the SINGLE SOURCE OF TRUTH for configuration.
	// Uses COMPOSITION pattern - we embed the generated Args struct
	// rather than duplicating its fields.
	// SubAgents are stored in Args.SubAgents - NOT as a separate field.
	Args *AgentArgs

	// Context reference (optional, used for typed variable management)
	ctx Context

	// mu protects concurrent access to mutable fields
	mu sync.Mutex
}

// New creates a new Agent with struct-based args (Pulumi pattern).
//
// The agent is automatically registered with the provided context for synthesis.
// Follows Pulumi's Args pattern: name as parameter, args struct for configuration.
//
// Required:
//   - name: agent name (lowercase alphanumeric with hyphens)
//   - args.Instructions: behavior instructions (min 10 characters)
//
// Optional args fields:
//   - Description: human-readable description
//   - IconUrl: icon URL for UI display
//
// Example (clean single-package import):
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/agent"
//	    "github.com/stigmer/stigmer/sdk/go/ref"
//	)
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	        Instructions: "Review code and suggest improvements",
//	        Description:  "Professional code reviewer",
//	    })
//	    if err != nil {
//	        return err
//	    }
//	    ag.AddSkillRef(ref.Skill("stigmer", "coding-best-practices"))
//	    ag.AddMcpServerUsage(ref.McpServer("stigmer", "github"), "create_pr", "search_code")
//	    return nil
//	})
func New(ctx Context, name string, args *AgentArgs) (*Agent, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &AgentArgs{}
	}

	// Initialize empty slices in Args to avoid nil pointer issues
	if args.SkillRefs == nil {
		args.SkillRefs = []*apiresource.ApiResourceReference{}
	}
	if args.McpServerUsages == nil {
		args.McpServerUsages = []*agentv1.McpServerUsage{}
	}
	if args.SubAgents == nil {
		args.SubAgents = []*agentv1.SubAgent{}
	}

	// Create Agent with Args as single source of truth
	a := &Agent{
		Name: name,
		Args: args,
		ctx:  ctx,
	}

	// Auto-generate slug from name if not provided
	if a.Slug == "" && a.Name != "" {
		a.Slug = naming.GenerateSlug(a.Name)
	}

	// If name not provided but slug is, use slug as name
	if a.Name == "" && a.Slug != "" {
		a.Name = a.Slug
	}

	// Validate the agent
	if err := validate(a); err != nil {
		return nil, err
	}

	// Validate slug format
	if a.Slug != "" {
		if err := naming.ValidateSlug(a.Slug); err != nil {
			return nil, err
		}
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterAgent(a)
	}

	return a, nil
}

// ============================================================================
// Builder Methods - Modify Args (single source of truth)
// ============================================================================

// AddSkillRef adds a skill reference to the agent.
//
// Use ref.Skill() to create skill references.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	import "github.com/stigmer/stigmer/sdk/go/ref"
//
//	agent.AddSkillRef(ref.Skill("stigmer", "coding-best-practices"))
//	agent.AddSkillRef(ref.Skill("stigmer", "code-review", ref.WithVersion("v1.0")))
func (a *Agent) AddSkillRef(ref *apiresource.ApiResourceReference) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, ref)
	return a
}

// AddSkillRefs adds multiple skill references to the agent.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent.AddSkillRefs(
//	    skillref.Platform("coding-best-practices"),
//	    skillref.Platform("security-guidelines", "stable"),
//	)
func (a *Agent) AddSkillRefs(refs ...*apiresource.ApiResourceReference) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, refs...)
	return a
}

// AddOrgSkillRef adds an organization-scoped skill reference using the agent's Org.
//
// This is a convenience method that creates a skill reference scoped to the
// agent's organization. The agent's Org field must be set for this to work correctly.
//
// Version is optional - if omitted or empty, "latest" is used.
//
// Example:
//
//	agent.AddOrgSkillRef("internal-docs")           // Latest version
//	agent.AddOrgSkillRef("internal-docs", "v2.0")   // Specific version
//	agent.AddOrgSkillRef("security-policy", "stable")
func (a *Agent) AddOrgSkillRef(slug string, version ...string) *Agent {
	ref := &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_skill,
		Slug: slug,
		Org:  a.Org,
	}
	if len(version) > 0 && version[0] != "" {
		ref.Version = version[0]
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, ref)
	return a
}

// ============================================================================
// Smart Parsing Methods - Add skills and MCP servers with org/slug parsing
// ============================================================================

// AddSkill adds a skill reference using smart org/slug parsing.
//
// Smart parsing rules:
//   - If ref contains "/", it's parsed as "org/slug" or "org/slug@version"
//   - If ref has no "/", the agent's Org is used with ref as the slug
//   - Version can be in the string (after @) or via AtVersion option
//
// Panics if the format is invalid or if Org is required but not set.
// For dynamic/user-provided input, use TryAddSkill instead.
//
// This method is thread-safe and can be called concurrently.
//
// Examples:
//
//	// Set agent org first for slug-only references
//	agent.Org = "my-org"
//
//	agent.AddSkill("web-search")                    // Uses agent.Org → "my-org/web-search"
//	agent.AddSkill("stigmer/web-search")            // Explicit org
//	agent.AddSkill("stigmer/web-search@v1.0")       // With version in string
//	agent.AddSkill("web-search", AtVersion("v1.0")) // With version option
//
//	// Chain multiple skills
//	agent.AddSkill("code-review").AddSkill("security-analysis")
func (a *Agent) AddSkill(ref string, opts ...SkillOption) *Agent {
	parsed, err := parseSkillRef(ref, a.Org, opts...)
	if err != nil {
		panic(err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, parsed)
	return a
}

// AddSkills adds multiple skill references using smart org/slug parsing.
//
// Each reference follows the same parsing rules as AddSkill.
// Panics on the first invalid reference.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent.Org = "my-org"
//	agent.AddSkills(
//	    "web-search",                // Uses agent.Org
//	    "stigmer/code-review",       // Explicit org
//	    "stigmer/security@v2.0",     // With version
//	)
func (a *Agent) AddSkills(refs ...string) *Agent {
	if len(refs) == 0 {
		return a
	}

	// Parse all refs first to fail fast before modifying state
	parsed := make([]*apiresource.ApiResourceReference, len(refs))
	for i, ref := range refs {
		p, err := parseSkillRef(ref, a.Org)
		if err != nil {
			panic(err)
		}
		parsed[i] = p
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, parsed...)
	return a
}

// TryAddSkill is like AddSkill but returns an error instead of panicking.
//
// Use this for dynamic/user-provided references where panicking is not appropriate.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	ref := getUserInput() // Dynamic input
//	agent, err := agent.TryAddSkill(ref)
//	if err != nil {
//	    var parseErr *RefParseError
//	    if errors.As(err, &parseErr) {
//	        log.Printf("Invalid skill reference %q: %s", parseErr.Ref, parseErr.Message)
//	    }
//	    return err
//	}
func (a *Agent) TryAddSkill(ref string, opts ...SkillOption) (*Agent, error) {
	parsed, err := parseSkillRef(ref, a.Org, opts...)
	if err != nil {
		return a, err
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, parsed)
	return a, nil
}

// TryAddSkills is like AddSkills but returns an error instead of panicking.
//
// Stops on the first invalid reference and returns the error.
// No skills are added if any reference is invalid (atomic operation).
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	refs := getSkillRefsFromConfig() // Dynamic input
//	agent, err := agent.TryAddSkills(refs...)
//	if err != nil {
//	    return fmt.Errorf("invalid skill configuration: %w", err)
//	}
func (a *Agent) TryAddSkills(refs ...string) (*Agent, error) {
	if len(refs) == 0 {
		return a, nil
	}

	// Parse all refs first to fail fast before modifying state
	parsed := make([]*apiresource.ApiResourceReference, len(refs))
	for i, ref := range refs {
		p, err := parseSkillRef(ref, a.Org)
		if err != nil {
			return a, err
		}
		parsed[i] = p
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SkillRefs = append(a.Args.SkillRefs, parsed...)
	return a, nil
}

// ============================================================================
// Legacy Builder Methods - Retained for backward compatibility
// ============================================================================

// AddMcpServerUsage adds an MCP server usage to the agent.
//
// Use ref.McpServer() to create the reference. Optionally specify which tools
// to enable from the server.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	import "github.com/stigmer/stigmer/sdk/go/ref"
//
//	// Enable all tools from the GitHub MCP server
//	agent.AddMcpServerUsage(ref.McpServer("stigmer", "github"))
//
//	// Enable specific tools only
//	agent.AddMcpServerUsage(
//	    ref.McpServer("stigmer", "github"),
//	    "create_issue", "list_repos", "create_pr",
//	)
//
//	// Reference an organization MCP server
//	agent.AddMcpServerUsage(ref.McpServer("acme-corp", "internal-tools"))
func (a *Agent) AddMcpServerUsage(ref *apiresource.ApiResourceReference, enabledTools ...string) *Agent {
	usage := &agentv1.McpServerUsage{
		McpServerRef: ref,
		EnabledTools: enabledTools,
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.McpServerUsages = append(a.Args.McpServerUsages, usage)
	return a
}

// AddMcpServerUsages adds multiple MCP server usages to the agent.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent.AddMcpServerUsages(
//	    &agentv1.McpServerUsage{
//	        McpServerRef: mcpserverref.Platform("github"),
//	        EnabledTools: []string{"create_pr", "search_code"},
//	    },
//	    &agentv1.McpServerUsage{
//	        McpServerRef: mcpserverref.Platform("aws"),
//	    },
//	)
func (a *Agent) AddMcpServerUsages(usages ...*agentv1.McpServerUsage) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.McpServerUsages = append(a.Args.McpServerUsages, usages...)
	return a
}

// UseMCPServer is a convenience method that adds a platform-scoped MCP server usage.
//
// This is a shorthand for AddMcpServerUsage with mcpserverref.Platform().
// For organization or personal MCP servers, use AddMcpServerUsage() directly.
//
// Example:
//
//	// Enable all tools
//	agent.UseMCPServer("github")
//
//	// Enable specific tools
//	agent.UseMCPServer("github", "create_issue", "list_repos")
//
//	// Chain multiple servers
//	agent.UseMCPServer("github", "create_pr").
//	      UseMCPServer("aws", "list_buckets").
//	      UseMCPServer("slack")
func (a *Agent) UseMCPServer(slug string, enabledTools ...string) *Agent {
	ref := &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}
	return a.AddMcpServerUsage(ref, enabledTools...)
}

// UseOrgMCPServer is a convenience method that adds an organization-scoped MCP server usage.
//
// This is a shorthand for AddMcpServerUsage with mcpserverref.Organization().
// Uses the agent's Org field for the organization.
//
// Example:
//
//	agent.UseOrgMCPServer("internal-tools")
//	agent.UseOrgMCPServer("internal-tools", "tool1", "tool2")
func (a *Agent) UseOrgMCPServer(slug string, enabledTools ...string) *Agent {
	ref := &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
		Org:  a.Org,
	}
	return a.AddMcpServerUsage(ref, enabledTools...)
}

// UseMCP adds an MCP server using smart org/slug parsing.
//
// Smart parsing rules:
//   - If ref contains "/", it's parsed as "org/slug"
//   - If ref has no "/", the agent's Org is used with ref as the slug
//
// Note: Unlike skills, MCP servers do not support versioning.
//
// Panics if the format is invalid or if Org is required but not set.
// For dynamic/user-provided input, use TryUseMCP instead.
//
// This method is thread-safe and can be called concurrently.
//
// Examples:
//
//	// Set agent org first for slug-only references
//	agent.Org = "my-org"
//
//	agent.UseMCP("github")                      // Uses agent.Org → "my-org/github"
//	agent.UseMCP("stigmer/github")              // Explicit org
//	agent.UseMCP("github", "create_pr")         // With specific tools
//	agent.UseMCP("stigmer/github", "search")    // Explicit org with tools
//
//	// Chain multiple servers
//	agent.UseMCP("github", "create_pr").UseMCP("slack", "send_message")
func (a *Agent) UseMCP(ref string, enabledTools ...string) *Agent {
	parsed, err := parseMcpServerRef(ref, a.Org)
	if err != nil {
		panic(err)
	}

	usage := &agentv1.McpServerUsage{
		McpServerRef: parsed,
		EnabledTools: enabledTools,
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.McpServerUsages = append(a.Args.McpServerUsages, usage)
	return a
}

// TryUseMCP is like UseMCP but returns an error instead of panicking.
//
// Use this for dynamic/user-provided references where panicking is not appropriate.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	ref := getUserInput() // Dynamic input
//	agent, err := agent.TryUseMCP(ref, "tool1", "tool2")
//	if err != nil {
//	    var parseErr *RefParseError
//	    if errors.As(err, &parseErr) {
//	        log.Printf("Invalid MCP server reference %q: %s", parseErr.Ref, parseErr.Message)
//	    }
//	    return err
//	}
func (a *Agent) TryUseMCP(ref string, enabledTools ...string) (*Agent, error) {
	parsed, err := parseMcpServerRef(ref, a.Org)
	if err != nil {
		return a, err
	}

	usage := &agentv1.McpServerUsage{
		McpServerRef: parsed,
		EnabledTools: enabledTools,
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.McpServerUsages = append(a.Args.McpServerUsages, usage)
	return a, nil
}

// ============================================================================
// SubAgent Methods
// ============================================================================

// AddSubAgent adds a sub-agent to Args.SubAgents (single source of truth).
// This method is thread-safe and can be called concurrently.
//
// Use NewSubAgent() or BuildSubAgent() to create sub-agents ergonomically.
//
// Example:
//
//	sub := agent.BuildSubAgent("security", "Check code for security issues").
//	    GrantMcpAccess("github", "search_code").
//	    Build()
//	ag.AddSubAgent(sub)
//
//	// Or directly with proto type:
//	ag.AddSubAgent(&agentv1.SubAgent{
//	    Name:         "security",
//	    Instructions: "Check code for security issues",
//	})
func (a *Agent) AddSubAgent(sub *agentv1.SubAgent) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SubAgents = append(a.Args.SubAgents, sub)
	return a
}

// AddSubAgents adds multiple sub-agents to Args.SubAgents (single source of truth).
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	ag.AddSubAgents(
//	    agent.NewSubAgent("analyzer", "Analyze code"),
//	    agent.NewSubAgent("reviewer", "Review changes"),
//	)
func (a *Agent) AddSubAgents(subs ...*agentv1.SubAgent) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	a.Args.SubAgents = append(a.Args.SubAgents, subs...)
	return a
}

// ============================================================================
// Environment Variable Declaration Methods
// ============================================================================

// RequireSecret declares that this agent requires a secret env var.
// This adds to Args.EnvSpec with is_secret=true and empty value (must be provided at runtime).
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent.RequireSecret("GITHUB_TOKEN", "GitHub API token for repository access")
//	agent.RequireSecret("AWS_SECRET_KEY", "AWS secret access key")
func (a *Agent) RequireSecret(name, description string) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.ensureEnvSpec()
	a.Args.EnvSpec.Data[name] = &environmentv1.EnvironmentValue{
		Value:       "", // Empty = must be provided at instance time
		IsSecret:    true,
		Description: description,
	}
	return a
}

// RequireConfig declares that this agent requires a config env var (non-secret).
// This adds to Args.EnvSpec with is_secret=false.
//
// If defaultValue is non-empty, it will be used when the variable is not provided.
// If defaultValue is empty, the variable is required at runtime.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent.RequireConfig("AWS_REGION", "us-east-1", "AWS region for deployments")
//	agent.RequireConfig("LOG_LEVEL", "info", "Logging verbosity")
//	agent.RequireConfig("ENVIRONMENT", "", "Deployment environment (required)")
func (a *Agent) RequireConfig(name, defaultValue, description string) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.ensureEnvSpec()
	a.Args.EnvSpec.Data[name] = &environmentv1.EnvironmentValue{
		Value:       defaultValue,
		IsSecret:    false,
		Description: description,
	}
	return a
}

// ensureEnvSpec ensures Args and Args.EnvSpec are initialized.
// Must be called with a.mu held.
func (a *Agent) ensureEnvSpec() {
	if a.Args == nil {
		a.Args = &AgentArgs{}
	}
	if a.Args.EnvSpec == nil {
		a.Args.EnvSpec = &environmentv1.EnvironmentSpec{
			Data: make(map[string]*environmentv1.EnvironmentValue),
		}
	}
	if a.Args.EnvSpec.Data == nil {
		a.Args.EnvSpec.Data = make(map[string]*environmentv1.EnvironmentValue)
	}
}

// String returns a string representation of the Agent.
func (a *Agent) String() string {
	return "Agent(name=" + a.Name + ")"
}
