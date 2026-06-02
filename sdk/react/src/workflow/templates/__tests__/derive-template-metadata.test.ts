import { describe, it, expect } from "vitest";
import { deriveTemplateMeta } from "../derive-template-metadata";

describe("deriveTemplateMeta", () => {
  it("extracts task count and kinds from a simple workflow", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: step_1
      kind: llm_call
      task_config:
        model: gpt-4o
    - name: step_2
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: "."
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.taskCount).toBe(2);
    expect(meta.taskKinds).toEqual(["llm_call", "transform"]);
  });

  it("counts environment variables", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  env:
    API_KEY:
      description: API key
      is_secret: true
    TOPIC:
      description: Topic
  tasks:
    - name: step_1
      kind: llm_call
      task_config:
        model: gpt-4o
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.envVarCount).toBe(2);
  });

  it("detects budget presence", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  budget:
    max_cost_micros: 1000000
  tasks:
    - name: step_1
      kind: llm_call
      task_config:
        model: gpt-4o
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.hasBudget).toBe(true);
  });

  it("detects parallel pattern from fork kind", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: analyze
      kind: llm_call
      task_config:
        model: gpt-4o
    - name: parallel_step
      kind: fork
      task_config:
        branches:
          - name: branch_a
            do:
              - name: summarize
                kind: llm_call
                task_config:
                  model: gpt-4o
          - name: branch_b
            do:
              - name: extract
                kind: transform
                task_config:
                  engine: TRANSFORM_ENGINE_JQ
                  expression: "."
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("parallel");
    expect(meta.taskKinds).toContain("fork");
    expect(meta.taskKinds).toContain("llm_call");
    expect(meta.taskKinds).toContain("transform");
  });

  it("detects branching pattern from switch_case", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: classify
      kind: llm_call
      task_config:
        model: gpt-4o
    - name: route
      kind: switch_case
      task_config:
        cases:
          - name: high
            when: "true"
            then: end
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("branching");
  });

  it("detects HITL pattern from human_input", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: review
      kind: human_input
      task_config:
        prompt: Please review
        outcomes:
          - name: approve
            label: Approve
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("hitl");
  });

  it("detects loop pattern from backward flow.then reference", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: draft
      kind: llm_call
      task_config:
        model: gpt-4o
      flow:
        then: review
    - name: review
      kind: human_input
      task_config:
        prompt: Approve?
        outcomes:
          - name: approve
            label: Approve
          - name: revise
            label: Revise
            then: draft
      flow:
        then: end
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("loop");
  });

  it("detects error-handling pattern from try_catch", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: safe_call
      kind: try_catch
      task_config:
        do:
          - name: api_call
            kind: http_call
            task_config:
              method: GET
              url: https://api.example.com
        catch:
          - name: handler
            do:
              - name: fallback
                kind: set_vars
                task_config:
                  vars:
                    error: true
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("error-handling");
    expect(meta.patterns).toContain("http-integration");
    expect(meta.taskKinds).toContain("try_catch");
    expect(meta.taskKinds).toContain("http_call");
    expect(meta.taskKinds).toContain("set_vars");
  });

  it("detects batch pattern from for_each", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: process_items
      kind: for_each
      task_config:
        collection: "\${ .items }"
        do:
          - name: enrich
            kind: http_call
            task_config:
              method: POST
              url: https://api.example.com/enrich
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("batch");
    expect(meta.taskKinds).toContain("for_each");
    expect(meta.taskKinds).toContain("http_call");
  });

  it("detects ai-pipeline when multiple agent_call tasks exist", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test
    version: "1.0.0"
  tasks:
    - name: agent_1
      kind: agent_call
      task_config:
        agent: analyst
    - name: agent_2
      kind: agent_call
      task_config:
        agent: writer
    - name: merge
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: "."
`;
    const meta = deriveTemplateMeta(yaml);
    expect(meta.patterns).toContain("ai-pipeline");
  });

  it("returns empty meta for invalid YAML", () => {
    const meta = deriveTemplateMeta("not: [valid: yaml: {{{");
    expect(meta.taskCount).toBe(0);
    expect(meta.taskKinds).toEqual([]);
    expect(meta.patterns).toEqual([]);
  });

  it("returns empty meta for YAML without spec", () => {
    const meta = deriveTemplateMeta("apiVersion: v1\nkind: Workflow\n");
    expect(meta.taskCount).toBe(0);
  });
});
