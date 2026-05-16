/**
 * Minimal valid workflow YAML used as the starting point when creating
 * a new workflow from the visual editor or code editor.
 *
 * Includes a single `agent_call` task so the user sees a meaningful
 * canvas node immediately rather than an empty graph.
 */
export const STARTER_WORKFLOW_YAML = `name: my-workflow
description: A new workflow
tasks:
  - name: step_1
    kind: agent_call
    config:
      agent_ref: "org/agent-slug"
    flow:
      then: end
`;
