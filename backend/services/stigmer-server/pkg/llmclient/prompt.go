package llmclient

import (
	"encoding/json"
	"fmt"
	"strings"
)

// OrgContext contains information about the organization's available resources
// that the LLM can reference when generating a workflow.
type OrgContext struct {
	Agents     []ResourceSummary
	McpServers []ResourceSummary
	Skills     []ResourceSummary
	Workflows  []ResourceSummary
}

// ResourceSummary is a minimal representation of an org resource for prompt context.
type ResourceSummary struct {
	Slug        string
	Description string
}

// TaskKindSummary is extracted from the task-kind-registry.json for prompt context.
type TaskKindSummary struct {
	Kind         string `json:"kind"`
	DisplayName  string `json:"displayName"`
	Description  string `json:"description"`
	Category     string `json:"category"`
	IsAINative   bool   `json:"isAiNative"`
	YAMLExamples []string `json:"yamlExamples"`
}

// ParseTaskKindSummaries extracts the minimal information needed for the prompt
// from the full task-kind-registry.json.
func ParseTaskKindSummaries(registryJSON []byte) ([]TaskKindSummary, error) {
	var registry struct {
		Descriptors []TaskKindSummary `json:"descriptors"`
	}
	if err := json.Unmarshal(registryJSON, &registry); err != nil {
		return nil, fmt.Errorf("parse task kind registry: %w", err)
	}
	return registry.Descriptors, nil
}

// BuildGenerationPrompt constructs the system and user prompts for workflow
// generation from a natural language description.
//
// The system prompt contains:
//   - Workflow YAML structure rules
//   - All 19 task kinds with descriptions and YAML examples
//   - Available organization resources (agents, MCP servers, skills)
//   - 2 canonical example workflows
//
// The user prompt contains the user's natural language description
// and any task kind hints.
func BuildGenerationPrompt(
	userDescription string,
	taskKinds []TaskKindSummary,
	orgCtx OrgContext,
	taskKindHints []string,
) (systemPrompt, userPrompt string) {
	var sys strings.Builder

	sys.WriteString(systemPromptHeader)
	sys.WriteString("\n\n")
	writeWorkflowStructure(&sys)
	sys.WriteString("\n\n")
	writeTaskKindReference(&sys, taskKinds, taskKindHints)
	sys.WriteString("\n\n")
	writeOrgContext(&sys, orgCtx)
	sys.WriteString("\n\n")
	writeExampleWorkflows(&sys)
	sys.WriteString("\n\n")
	writeGenerationRules(&sys)

	var usr strings.Builder
	usr.WriteString(userDescription)
	if len(taskKindHints) > 0 {
		fmt.Fprintf(&usr, "\n\nHint: I'd like this workflow to use these task kinds: %s",
			strings.Join(taskKindHints, ", "))
	}

	return sys.String(), usr.String()
}

const systemPromptHeader = `You are a workflow architect for the Stigmer platform. Your job is to generate valid Stigmer Workflow YAML from natural language descriptions.

You MUST respond with exactly two sections:
1. A YAML code block containing the complete workflow definition
2. A plain-text explanation of what you generated and why

Format your response as:
` + "```yaml" + `
<workflow YAML here>
` + "```" + `
<explanation here>`

func writeWorkflowStructure(sb *strings.Builder) {
	sb.WriteString(`## Workflow YAML Structure

Every workflow YAML must have this top-level structure:

` + "```yaml" + `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: my-workflow        # Display name (human-readable)
  org: <org-slug>          # Organization this workflow belongs to
spec:
  description: "What this workflow does"
  document:
    dsl: "1.0.0"           # Always "1.0.0"
    namespace: <org-slug>  # Usually same as metadata.org
    name: my-workflow      # Identifier (lowercase, hyphens)
    version: "1.0.0"       # Semver version
  tasks:
    - <task definitions>   # Ordered list of tasks
  env:                     # Optional: environment variable declarations
    API_KEY:
      is_secret: true
      description: "API key for external service"
  budget:                  # Optional: execution budget limits
    max_cost_micros: 5000000   # $5.00 (1 USD = 1,000,000 micros)
    max_total_tokens: 500000
    max_duration_seconds: 3600
    on_exceeded: budget_exceeded_terminate
` + "```" + `

### Task Structure

Each task in the tasks list has this structure:

` + "```yaml" + `
- task_name:              # Unique name for this task
    <kind>:               # Task kind (determines the configuration)
      <config fields>     # Kind-specific configuration
    export:               # Optional: save output to workflow context
      as: "${.}"          # Expression for what to export
    then: next_task_name  # Optional: jump to specific task (default: next in list)
` + "```")
}

func writeTaskKindReference(sb *strings.Builder, kinds []TaskKindSummary, hints []string) {
	sb.WriteString("## Available Task Kinds\n\n")

	hintSet := make(map[string]bool)
	for _, h := range hints {
		hintSet[h] = true
	}

	categories := map[string][]TaskKindSummary{}
	var categoryOrder []string
	for _, k := range kinds {
		if _, seen := categories[k.Category]; !seen {
			categoryOrder = append(categoryOrder, k.Category)
		}
		categories[k.Category] = append(categories[k.Category], k)
	}

	for _, cat := range categoryOrder {
		fmt.Fprintf(sb, "### %s\n\n", strings.Title(cat))
		for _, k := range categories[cat] {
			showExample := hintSet[k.Kind] || len(hints) == 0
			fmt.Fprintf(sb, "**%s** (`%s`): %s\n", k.DisplayName, k.Kind, k.Description)
			if showExample && len(k.YAMLExamples) > 0 {
				sb.WriteString("Example:\n")
				sb.WriteString("```yaml\n")
				sb.WriteString(strings.TrimSpace(k.YAMLExamples[0]))
				sb.WriteString("\n```\n")
			}
			sb.WriteString("\n")
		}
	}
}

func writeOrgContext(sb *strings.Builder, ctx OrgContext) {
	sb.WriteString("## Available Resources in This Organization\n\n")

	if len(ctx.Agents) > 0 {
		sb.WriteString("### Agents\n")
		sb.WriteString("These agents can be invoked via `agent_call` tasks:\n\n")
		for _, a := range ctx.Agents {
			fmt.Fprintf(sb, "- **%s**", a.Slug)
			if a.Description != "" {
				fmt.Fprintf(sb, ": %s", a.Description)
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	if len(ctx.McpServers) > 0 {
		sb.WriteString("### MCP Servers\n")
		sb.WriteString("These MCP servers provide tools that agents can use:\n\n")
		for _, m := range ctx.McpServers {
			fmt.Fprintf(sb, "- **%s**", m.Slug)
			if m.Description != "" {
				fmt.Fprintf(sb, ": %s", m.Description)
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	if len(ctx.Skills) > 0 {
		sb.WriteString("### Skills\n\n")
		for _, s := range ctx.Skills {
			fmt.Fprintf(sb, "- **%s**", s.Slug)
			if s.Description != "" {
				fmt.Fprintf(sb, ": %s", s.Description)
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	if len(ctx.Agents) == 0 && len(ctx.McpServers) == 0 && len(ctx.Skills) == 0 {
		sb.WriteString("No agents, MCP servers, or skills are configured in this organization yet.\n")
		sb.WriteString("You can still generate workflows using built-in task kinds (llm_call, http_call, transform, etc.).\n\n")
	}
}

func writeExampleWorkflows(sb *strings.Builder) {
	sb.WriteString("## Example Workflows\n\n")
	sb.WriteString("### Example 1: Content Review Pipeline (linear with approval)\n\n")
	sb.WriteString("```yaml\n")
	sb.WriteString(exampleWorkflow1)
	sb.WriteString("\n```\n\n")
	sb.WriteString("### Example 2: Data Processing with Branching\n\n")
	sb.WriteString("```yaml\n")
	sb.WriteString(exampleWorkflow2)
	sb.WriteString("\n```\n")
}

const exampleWorkflow1 = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: Content Review Pipeline
  org: acme
spec:
  description: "Reviews content with AI and routes for human approval"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: content-review-pipeline
    version: "1.0.0"
  tasks:
    - analyze_content:
        llm_call:
          model: gpt-4o
          prompt: "Analyze the following content for quality and compliance: ${.input.content}"
          output_schema:
            type: object
            properties:
              quality_score:
                type: number
              issues:
                type: array
                items:
                  type: string
              recommendation:
                type: string
                enum: [approve, reject, needs_review]
        export:
          as: "${.}"
    - route_decision:
        switch_case:
          cases:
            - name: auto_approve
              when: "${.analyze_content.recommendation == 'approve' && .analyze_content.quality_score > 0.8}"
              then: send_approval_notification
            - name: auto_reject
              when: "${.analyze_content.recommendation == 'reject'}"
              then: send_rejection_notification
          default_case:
            then: human_review
    - human_review:
        human_input:
          prompt: "Please review this content. AI analysis: quality=${.analyze_content.quality_score}, issues=${.analyze_content.issues}"
          outcomes:
            - name: approve
              then: send_approval_notification
            - name: reject
              then: send_rejection_notification
          timeout_seconds: 86400
          timeout_policy: TIMEOUT_POLICY_ESCALATE
    - send_approval_notification:
        notification:
          channel: webhook
          recipient: "${.input.callback_url}"
          message: "Content approved"
        then: end
    - send_rejection_notification:
        notification:
          channel: webhook
          recipient: "${.input.callback_url}"
          message: "Content rejected: ${.analyze_content.issues}"
        then: end
  budget:
    max_cost_micros: 1000000
    on_exceeded: budget_exceeded_terminate`

const exampleWorkflow2 = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: Data Processing Pipeline
  org: acme
spec:
  description: "Fetches data, transforms it, and validates the result"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: data-processing-pipeline
    version: "1.0.0"
  tasks:
    - fetch_data:
        http_call:
          method: GET
          endpoint:
            uri: "${.input.data_url}"
          headers:
            Authorization: "Bearer ${API_KEY}"
        export:
          as: "${.}"
    - transform_data:
        transform:
          engine: jq
          expression: ".fetch_data | { items: [.data[] | {id, name, value: (.amount * 100)}], total: ([.data[].amount] | add) }"
        export:
          as: "${.}"
    - validate_result:
        validate:
          schema:
            type: object
            required: [items, total]
            properties:
              items:
                type: array
                minItems: 1
              total:
                type: number
                minimum: 0
          on_fail: VALIDATION_ON_FAIL_RAISE
    - summarize:
        llm_call:
          model: gpt-4o-mini
          prompt: "Summarize this data: ${.transform_data.items | length} items, total value: ${.transform_data.total}"
        export:
          as: "${.}"
  env:
    API_KEY:
      is_secret: true
      description: "API key for the data source"
  budget:
    max_cost_micros: 500000
    max_total_tokens: 100000
    on_exceeded: budget_exceeded_warn`

// BuildRefinementPrompt constructs the system and user prompts for iterative
// workflow refinement. Unlike generation, the user already has a workflow YAML
// and wants to make a targeted change described by a natural language instruction.
//
// The system prompt includes:
//   - Workflow YAML structure rules (same as generation — LLM needs these to validate its output)
//   - Task kind reference (in case the user asks to add new tasks)
//   - Organization context (agents, MCP servers, skills)
//   - Refinement-specific rules emphasizing minimal, targeted changes
//
// The user prompt contains the current workflow YAML followed by the instruction.
func BuildRefinementPrompt(
	currentYAML string,
	instruction string,
	taskKinds []TaskKindSummary,
	orgCtx OrgContext,
) (systemPrompt, userPrompt string) {
	var sys strings.Builder

	sys.WriteString(refinementSystemPromptHeader)
	sys.WriteString("\n\n")
	writeWorkflowStructure(&sys)
	sys.WriteString("\n\n")
	writeTaskKindReference(&sys, taskKinds, nil)
	sys.WriteString("\n\n")
	writeOrgContext(&sys, orgCtx)
	sys.WriteString("\n\n")
	writeRefinementRules(&sys)

	var usr strings.Builder
	usr.WriteString("## Current Workflow\n\n```yaml\n")
	usr.WriteString(currentYAML)
	usr.WriteString("\n```\n\n")
	usr.WriteString("## Instruction\n\n")
	usr.WriteString(instruction)

	return sys.String(), usr.String()
}

const refinementSystemPromptHeader = `You are a workflow editor for the Stigmer platform. You receive an existing workflow YAML and a natural language instruction describing what to change.

Your job is to apply the requested change with surgical precision — modify only what the instruction asks for, and leave everything else untouched.

You MUST respond with exactly two sections:
1. A YAML code block containing the complete updated workflow YAML
2. A plain-text explanation focused on what you changed and why

Format your response as:
` + "```yaml" + `
<complete updated workflow YAML>
` + "```" + `
<explanation of what changed>`

func writeRefinementRules(sb *strings.Builder) {
	sb.WriteString(`## Refinement Rules

1. Only modify what the instruction asks for — do NOT reorganize, rename, or restructure unrelated parts
2. Preserve all existing task names, ordering, and configuration unless the instruction explicitly asks to change them
3. The output must be the COMPLETE updated workflow YAML, not a partial diff
4. Maintain the same apiVersion, kind, metadata structure, and spec.document fields unless the instruction targets them
5. When adding new tasks, place them at a logical position in the task flow and use snake_case names
6. When removing tasks, update any "then:" references that pointed to the removed task
7. Keep all existing export, then, and flow control references valid
8. Your explanation should describe ONLY what you changed — not what the entire workflow does
9. Be concise in your explanation: "Added a human_input task before send_notification with a 24-hour timeout" is better than a paragraph
10. If the instruction is ambiguous, make the most reasonable interpretation and note your assumption in the explanation`)
}

func writeGenerationRules(sb *strings.Builder) {
	sb.WriteString(`## Rules

1. Every workflow MUST have apiVersion, kind, metadata (with name and org), and spec
2. spec.document MUST have dsl: "1.0.0", namespace, name, and version
3. spec.tasks MUST contain at least one task
4. Every task MUST have a unique name and a valid task kind
5. Use flow.then or the "then:" shorthand only for non-sequential transitions (jumping to a different task or "end")
6. Use export.as with ${...} expressions to pass data between tasks
7. Use ${...} expressions for dynamic values referencing workflow context
8. Reference existing organization agents by their slug in agent_call tasks
9. Keep workflows focused — prefer 3-8 tasks; split larger workflows into sub-workflows
10. Declare environment variables in spec.env when the workflow needs external configuration
11. Set a budget when the workflow uses LLM or agent tasks
12. Use snake_case for task names
13. Always set the org field in metadata to match the user's organization
14. When using switch_case, every case must have a "then" pointing to a valid task or "end"
15. When using human_input, always set a reasonable timeout_seconds`)
}
