package stigmer

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"google.golang.org/protobuf/proto"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/internal/synth"
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

	// mu protects concurrent access to context state
	mu sync.RWMutex

	// synthesized tracks whether synthesis has been performed
	synthesized bool
}

// newContext creates a new Context instance.
// This is internal - users should use Run() instead.
func newContext() *Context {
	return &Context{
		variables: make(map[string]Ref),
		workflows: make([]*workflow.Workflow, 0),
		agents:    make([]*agent.Agent, 0),
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
func (c *Context) RegisterWorkflow(wf *workflow.Workflow) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.workflows = append(c.workflows, wf)
}

// RegisterAgent registers an agent with this context.
// This is typically called automatically by agent.New() when passed a context.
func (c *Context) RegisterAgent(ag *agent.Agent) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.agents = append(c.agents, ag)
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
	// Convert agents to manifest proto
	manifest, err := synth.ToManifest(agentInterfaces...)
	if err != nil {
		return fmt.Errorf("failed to convert agents to manifest: %w", err)
	}

	// Serialize to binary protobuf
	data, err := proto.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("failed to serialize agent manifest: %w", err)
	}

	// Write to agent-manifest.pb
	manifestPath := filepath.Join(outputDir, "agent-manifest.pb")
	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write agent manifest: %w", err)
	}

	return nil
}

// synthesizeWorkflows converts workflows to protobuf and writes to disk
func (c *Context) synthesizeWorkflows(outputDir string, workflowInterfaces []interface{}) error {
	// Convert context variables (map[string]Ref) to map[string]interface{} for synthesis
	contextVars := make(map[string]interface{}, len(c.variables))
	for name, ref := range c.variables {
		contextVars[name] = ref
	}

	// Convert workflows to manifest proto, passing context variables for injection
	manifest, err := synth.ToWorkflowManifestWithContext(contextVars, workflowInterfaces...)
	if err != nil {
		return fmt.Errorf("failed to convert workflows to manifest: %w", err)
	}

	// Serialize to binary protobuf
	data, err := proto.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("failed to serialize workflow manifest: %w", err)
	}

	// Write to workflow-manifest.pb
	manifestPath := filepath.Join(outputDir, "workflow-manifest.pb")
	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write workflow manifest: %w", err)
	}

	return nil
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
