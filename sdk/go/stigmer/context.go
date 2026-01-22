package stigmer

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"google.golang.org/protobuf/proto"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// Context is the central orchestration context for Stigmer SDK.
// It provides type-safe variable management and tracks all workflows and agents
// created within its scope.
//
// Context follows the Pulumi pattern where all resources are created within
// an explicit context that manages their lifecycle.
//
// Example:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    apiURL := ctx.SetString("apiURL", "https://api.example.com")
//	    
//	    wf, _ := workflow.New(ctx, ...)
//	    ag, _ := agent.New(ctx, ...)
//	    
//	    return nil
//	})
type Context struct {
	// variables stores all context variables by name
	variables map[string]Ref

	// workflows tracks all workflows created in this context
	workflows []*workflow.Workflow

	// agents tracks all agents created in this context
	agents []*agent.Agent

	// skills tracks all inline skills created in this context
	skills []*skill.Skill

	// dependencies tracks resource dependencies for creation order
	// Map format: resourceID -> []dependencyIDs
	// Example: "agent:code-reviewer" -> ["skill:code-analysis"]
	dependencies map[string][]string

	// mu protects concurrent access to context state
	mu sync.RWMutex

	// synthesized tracks whether synthesis has been performed
	synthesized bool
}

// newContext creates a new Context instance.
// This is internal - users should use Run() instead.
func newContext() *Context {
	return &Context{
		variables:    make(map[string]Ref),
		workflows:    make([]*workflow.Workflow, 0),
		agents:       make([]*agent.Agent, 0),
		skills:       make([]*skill.Skill, 0),
		dependencies: make(map[string][]string),
	}
}

// NewContext creates a new Context instance for testing or advanced use cases.
// For normal usage, prefer using Run() which handles context lifecycle automatically.
//
// Example (testing):
//
//	ctx := stigmer.NewContext()
//	apiURL := ctx.SetString("apiURL", "https://api.example.com")
func NewContext() *Context {
	return newContext()
}

// =============================================================================
// Variable Management - Typed Setters
// =============================================================================

// SetString creates a string variable in the context and returns a typed reference.
// The variable is resolved at synthesis time (compile-time) by interpolating ${variableName}
// placeholders in task configurations with the actual value.
//
// Example:
//
//	apiURL := ctx.SetString("apiURL", "https://api.example.com")
//	// In task config: "${apiURL}/users" → synthesizes to: "https://api.example.com/users"
func (c *Context) SetString(name, value string) *StringRef {
	c.mu.Lock()
	defer c.mu.Unlock()

	ref := &StringRef{
		baseRef: baseRef{
			name:     name,
			isSecret: false,
		},
		value: value,
	}
	c.variables[name] = ref
	return ref
}

// SetSecret creates a secret string variable in the context.
// Secrets are marked as sensitive and resolved at synthesis time like other variables.
// The secret value is baked into the task configuration during synthesis.
//
// Example:
//
//	apiKey := ctx.SetSecret("apiKey", "secret-key-123")
//	// In headers: "Bearer ${apiKey}" → synthesizes to: "Bearer secret-key-123"
func (c *Context) SetSecret(name, value string) *StringRef {
	c.mu.Lock()
	defer c.mu.Unlock()

	ref := &StringRef{
		baseRef: baseRef{
			name:     name,
			isSecret: true,
		},
		value: value,
	}
	c.variables[name] = ref
	return ref
}

// SetInt creates an integer variable in the context and returns a typed reference.
// The variable is resolved at synthesis time (compile-time).
//
// Example:
//
//	retries := ctx.SetInt("retries", 3)
//	// In config: {"max_retries": "${retries}"} → synthesizes to: {"max_retries": 3}
func (c *Context) SetInt(name string, value int) *IntRef {
	c.mu.Lock()
	defer c.mu.Unlock()

	ref := &IntRef{
		baseRef: baseRef{
			name:     name,
			isSecret: false,
		},
		value: value,
	}
	c.variables[name] = ref
	return ref
}

// SetBool creates a boolean variable in the context and returns a typed reference.
// The variable is resolved at synthesis time (compile-time).
//
// Example:
//
//	isProd := ctx.SetBool("isProd", true)
//	// In config: {"production": "${isProd}"} → synthesizes to: {"production": true}
func (c *Context) SetBool(name string, value bool) *BoolRef {
	c.mu.Lock()
	defer c.mu.Unlock()

	ref := &BoolRef{
		baseRef: baseRef{
			name:     name,
			isSecret: false,
		},
		value: value,
	}
	c.variables[name] = ref
	return ref
}

// SetObject creates an object (map) variable in the context and returns a typed reference.
// The variable is resolved at synthesis time (compile-time).
//
// Example:
//
//	config := ctx.SetObject("config", map[string]interface{}{
//	    "database": map[string]interface{}{
//	        "host": "localhost",
//	        "port": 5432,
//	    },
//	})
//	// In config: "${config}" → synthesizes to: {"database": {"host": "localhost", "port": 5432}}
func (c *Context) SetObject(name string, value map[string]interface{}) *ObjectRef {
	c.mu.Lock()
	defer c.mu.Unlock()

	ref := &ObjectRef{
		baseRef: baseRef{
			name:     name,
			isSecret: false,
		},
		value: value,
	}
	c.variables[name] = ref
	return ref
}

// =============================================================================
// Variable Retrieval
// =============================================================================

// Get retrieves a variable by name and returns its reference.
// Returns nil if the variable doesn't exist.
//
// Example:
//
//	ref := ctx.Get("apiURL")
//	if ref != nil {
//	    // Use the reference
//	}
func (c *Context) Get(name string) Ref {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.variables[name]
}

// GetString retrieves a string variable by name.
// Returns nil if the variable doesn't exist or is not a StringRef.
func (c *Context) GetString(name string) *StringRef {
	ref := c.Get(name)
	if stringRef, ok := ref.(*StringRef); ok {
		return stringRef
	}
	return nil
}

// GetInt retrieves an integer variable by name.
// Returns nil if the variable doesn't exist or is not an IntRef.
func (c *Context) GetInt(name string) *IntRef {
	ref := c.Get(name)
	if intRef, ok := ref.(*IntRef); ok {
		return intRef
	}
	return nil
}

// GetBool retrieves a boolean variable by name.
// Returns nil if the variable doesn't exist or is not a BoolRef.
func (c *Context) GetBool(name string) *BoolRef {
	ref := c.Get(name)
	if boolRef, ok := ref.(*BoolRef); ok {
		return boolRef
	}
	return nil
}

// GetObject retrieves an object variable by name.
// Returns nil if the variable doesn't exist or is not an ObjectRef.
func (c *Context) GetObject(name string) *ObjectRef {
	ref := c.Get(name)
	if objRef, ok := ref.(*ObjectRef); ok {
		return objRef
	}
	return nil
}

// ExportVariables exports all context variables as a map for synthesis.
// This is used internally during workflow synthesis to pass compile-time
// variables to the interpolation layer.
//
// The returned map contains variable names as keys and Ref interfaces as values.
// The synthesis layer extracts actual values using the ToValue() method.
//
// Example usage (internal):
//
//	manifest, err := synth.ToWorkflowManifestWithContext(ctx.ExportVariables(), wf)
func (c *Context) ExportVariables() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Convert variables map to interface map
	result := make(map[string]interface{}, len(c.variables))
	for name, ref := range c.variables {
		result[name] = ref
	}
	return result
}

// =============================================================================
// Resource Registration
// =============================================================================

// RegisterWorkflow registers a workflow with this context.
// This is typically called automatically by workflow.New() when passed a context.
//
// Dependency tracking: Scans workflow tasks for agent references and tracks
// dependencies automatically.
func (c *Context) RegisterWorkflow(wf *workflow.Workflow) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.workflows = append(c.workflows, wf)

	// Track agent dependencies from workflow tasks
	workflowID := workflowResourceID(wf)
	c.trackWorkflowAgentDependencies(workflowID, wf)
}

// RegisterAgent registers an agent with this context.
// This is typically called automatically by agent.New() when passed a context.
//
// Dependency tracking: Automatically tracks inline skill dependencies.
func (c *Context) RegisterAgent(ag *agent.Agent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.agents = append(c.agents, ag)

	// Track inline skill dependencies
	agentID := agentResourceID(ag)
	for i := range ag.Skills {
		if ag.Skills[i].IsInline {
			skillID := skillResourceID(&ag.Skills[i])
			c.addDependency(agentID, skillID)
		}
		// External/platform skills: no dependency (already exist)
	}
}

// RegisterSkill registers an inline skill with this context.
// This is typically called automatically when a skill is created and used by an agent.
//
// Only inline skills need registration - platform/org skills are references to
// existing resources and don't need creation.
func (c *Context) RegisterSkill(s *skill.Skill) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Only register inline skills
	if !s.IsInline {
		return
	}

	c.skills = append(c.skills, s)
	// Skills have no dependencies (they're always created first)
}

// =============================================================================
// Dependency Tracking (Internal)
// =============================================================================

// addDependency records that one resource depends on another.
// This is used internally during resource registration to build the dependency graph.
//
// Example: addDependency("agent:reviewer", "skill:code-analysis")
// means agent:reviewer must be created after skill:code-analysis
func (c *Context) addDependency(resourceID, dependsOnID string) {
	// Note: caller must hold c.mu.Lock()
	if c.dependencies[resourceID] == nil {
		c.dependencies[resourceID] = make([]string, 0)
	}
	c.dependencies[resourceID] = append(c.dependencies[resourceID], dependsOnID)
}

// trackWorkflowAgentDependencies scans workflow tasks for agent references
// and records dependencies.
func (c *Context) trackWorkflowAgentDependencies(workflowID string, wf *workflow.Workflow) {
	// Note: caller must hold c.mu.Lock()
	
	// Scan all tasks for agent_call task type
	for _, task := range wf.Tasks {
		if task.Kind == workflow.TaskKindAgentCall {
			// Extract agent reference from task config
			// TODO: This requires accessing the AgentCallTaskConfig
			// For now, we'll implement a helper method to extract agent refs
			agentRefs := extractAgentRefsFromTask(task)
			for _, agentRef := range agentRefs {
				// Only track dependencies for inline agents (not platform refs)
				if agentRef != "" {
					agentID := fmt.Sprintf("agent:%s", agentRef)
					c.addDependency(workflowID, agentID)
				}
			}
		}
	}
}

// extractAgentRefsFromTask extracts agent references from a workflow task.
// Returns agent names/slugs that this task depends on.
func extractAgentRefsFromTask(task *workflow.Task) []string {
	// TODO: Implement proper extraction from task config
	// This requires accessing AgentCallTaskConfig.Agent field
	// For now, return empty - this will be implemented when we have
	// better access to task configs
	return []string{}
}

// workflowResourceID generates a resource ID for a workflow.
func workflowResourceID(wf *workflow.Workflow) string {
	return fmt.Sprintf("workflow:%s", wf.Document.Name)
}

// agentResourceID generates a resource ID for an agent.
func agentResourceID(ag *agent.Agent) string {
	return fmt.Sprintf("agent:%s", ag.Name)
}

// skillResourceID generates a resource ID for a skill.
func skillResourceID(s *skill.Skill) string {
	if s.IsInline {
		return fmt.Sprintf("skill:%s", s.Name)
	}
	// External skills (platform/org) get different IDs to avoid tracking
	return fmt.Sprintf("skill:external:%s", s.Slug)
}

// =============================================================================
// Synthesis
// =============================================================================

// Synthesize converts all registered workflows and agents to their proto representations
// and writes them to disk. This is called automatically by Run() when the function completes.
func (c *Context) Synthesize() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.synthesized {
		return fmt.Errorf("context already synthesized")
	}

	// Get output directory from environment variable
	// If not set, we're in dry-run mode (just validate, don't write files)
	outputDir := os.Getenv("STIGMER_OUT_DIR")
	if outputDir == "" {
		// Dry-run mode: just mark as synthesized
		c.synthesized = true
		return nil
	}

	// Import synthesis package for converters
	// We'll call the converters to generate manifests
	if err := c.synthesizeManifests(outputDir); err != nil {
		return fmt.Errorf("synthesis failed: %w", err)
	}

	c.synthesized = true
	return nil
}

// synthesizeManifests writes agent and workflow manifests to disk
func (c *Context) synthesizeManifests(outputDir string) error {
	// Ensure output directory exists
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Convert agents to interfaces for the converter
	var agentInterfaces []interface{}
	for _, ag := range c.agents {
		agentInterfaces = append(agentInterfaces, ag)
	}

	// Convert workflows to interfaces for the converter
	var workflowInterfaces []interface{}
	for _, wf := range c.workflows {
		workflowInterfaces = append(workflowInterfaces, wf)
	}

	// Synthesize agents if any exist
	if len(agentInterfaces) > 0 {
		if err := c.synthesizeAgents(outputDir, agentInterfaces); err != nil {
			return err
		}
	}

	// Synthesize workflows if any exist
	if len(workflowInterfaces) > 0 {
		if err := c.synthesizeWorkflows(outputDir, workflowInterfaces); err != nil {
			return err
		}
	}

	return nil
}

// synthesizeAgents converts agents to protobuf and writes to disk
func (c *Context) synthesizeAgents(outputDir string, agentInterfaces []interface{}) error {
	// Convert each agent to proto and write individually
	for i, agentInterface := range agentInterfaces {
		ag, ok := agentInterface.(*agent.Agent)
		if !ok {
			return fmt.Errorf("agent[%d]: invalid type %T, expected *agent.Agent", i, agentInterface)
		}

		// Convert agent to proto using new ToProto() method
		agentProto, err := ag.ToProto()
		if err != nil {
			return fmt.Errorf("failed to convert agent %q to proto: %w", ag.Name, err)
		}

		// Serialize to binary protobuf
		data, err := proto.Marshal(agentProto)
		if err != nil {
			return fmt.Errorf("failed to serialize agent %q: %w", ag.Name, err)
		}

		// Write to agent-{name}.pb
		filename := fmt.Sprintf("agent-%s.pb", ag.Name)
		agentPath := filepath.Join(outputDir, filename)
		if err := os.WriteFile(agentPath, data, 0644); err != nil {
			return fmt.Errorf("failed to write agent %q: %w", ag.Name, err)
		}
	}

	return nil
}

// synthesizeWorkflows converts workflows to protobuf and writes to disk
func (c *Context) synthesizeWorkflows(outputDir string, workflowInterfaces []interface{}) error {
	// TODO: Implement workflow ToProto() similar to agent
	// For now, workflows still use the old synthesis approach
	// This is out of scope for the current Agent/Skill SDK work
	return fmt.Errorf("workflow synthesis not yet migrated to new ToProto() approach - see https://github.com/stigmer/stigmer/issues/XXX")
}

// =============================================================================
// Context Lifecycle - Run Pattern
// =============================================================================

// Run executes a function with a new Context and automatically handles synthesis.
// This is the primary entry point for using the Stigmer SDK with typed context.
//
// The function is called with a fresh Context instance. Any workflows or agents
// created within the function are automatically registered and synthesized when
// the function completes successfully.
//
// Example:
//
//	func main() {
//	    err := stigmer.Run(func(ctx *stigmer.Context) error {
//	        apiURL := ctx.SetString("apiURL", "https://api.example.com")
//	        
//	        wf, err := workflow.New(ctx,
//	            workflow.WithName("data-pipeline"),
//	            workflow.WithNamespace("my-org"),
//	        )
//	        if err != nil {
//	            return err
//	        }
//	        
//	        task, _ := wf.AddHTTPTask(
//	            workflow.WithURI(apiURL.Append("/users")),
//	        )
//	        
//	        return nil
//	    })
//	    if err != nil {
//	        log.Fatal(err)
//	    }
//	}
func Run(fn func(*Context) error) error {
	ctx := newContext()

	// Execute the user function
	if err := fn(ctx); err != nil {
		return fmt.Errorf("context function failed: %w", err)
	}

	// Synthesize all resources
	if err := ctx.Synthesize(); err != nil {
		return fmt.Errorf("synthesis failed: %w", err)
	}

	return nil
}

// =============================================================================
// Inspection Methods (for debugging and testing)
// =============================================================================

// Variables returns a copy of all variables in the context.
// This is primarily useful for testing and debugging.
func (c *Context) Variables() map[string]Ref {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Return a copy to prevent external modification
	result := make(map[string]Ref, len(c.variables))
	for k, v := range c.variables {
		result[k] = v
	}
	return result
}

// Workflows returns a copy of all workflows registered in the context.
// This is primarily useful for testing and debugging.
func (c *Context) Workflows() []*workflow.Workflow {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Return a copy to prevent external modification
	result := make([]*workflow.Workflow, len(c.workflows))
	copy(result, c.workflows)
	return result
}

// Agents returns a copy of all agents registered in the context.
// This is primarily useful for testing and debugging.
func (c *Context) Agents() []*agent.Agent {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Return a copy to prevent external modification
	result := make([]*agent.Agent, len(c.agents))
	copy(result, c.agents)
	return result
}

// Skills returns a copy of all inline skills registered in the context.
// This is primarily useful for testing and debugging.
func (c *Context) Skills() []*skill.Skill {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Return a copy to prevent external modification
	result := make([]*skill.Skill, len(c.skills))
	copy(result, c.skills)
	return result
}

// Dependencies returns a copy of the dependency graph.
// The map format is: resourceID -> []dependencyIDs
//
// Example:
//
//	deps := ctx.Dependencies()
//	// deps["agent:code-reviewer"] = ["skill:code-analysis"]
//	// deps["workflow:pr-review"] = ["agent:code-reviewer"]
//
// This is primarily useful for testing, debugging, and CLI implementation.
func (c *Context) Dependencies() map[string][]string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Return a deep copy to prevent external modification
	result := make(map[string][]string, len(c.dependencies))
	for k, v := range c.dependencies {
		deps := make([]string, len(v))
		copy(deps, v)
		result[k] = deps
	}
	return result
}

// GetDependencies returns the direct dependencies for a specific resource.
// Returns nil if the resource has no dependencies or doesn't exist.
//
// Example:
//
//	deps := ctx.GetDependencies("agent:code-reviewer")
//	// deps = ["skill:code-analysis"]
func (c *Context) GetDependencies(resourceID string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	deps := c.dependencies[resourceID]
	if deps == nil {
		return nil
	}

	// Return a copy to prevent external modification
	result := make([]string, len(deps))
	copy(result, deps)
	return result
}
