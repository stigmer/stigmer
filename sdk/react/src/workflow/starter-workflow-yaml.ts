/**
 * Minimal valid workflow YAML used as the starting point when creating
 * a new workflow from the visual editor or code editor.
 *
 * Uses the full envelope format (`apiVersion` / `kind` / `metadata` / `spec`)
 * so `yamlToGraph()` can parse it in visual mode without errors.
 *
 * Includes a single `agent_call` task so the user sees a meaningful
 * canvas node immediately rather than an empty graph.
 */
export const STARTER_WORKFLOW_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: my-workflow
spec:
  description: A new workflow
  document:
    dsl: "1.0.0"
    namespace: default
    name: my-workflow
    version: "0.1.0"
  tasks:
    - name: step_1
      kind: agent_call
      task_config:
        agent: "org/agent-slug"
        message: "Describe what this step should do"
      flow:
        then: end
`;
