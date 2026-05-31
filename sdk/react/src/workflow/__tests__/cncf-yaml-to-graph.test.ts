import { describe, test, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import { cncfYamlToGraph, isCncfWorkflowYaml } from "../cncf-yaml-to-graph";

// ---------------------------------------------------------------------------
// isCncfWorkflowYaml
// ---------------------------------------------------------------------------

describe("isCncfWorkflowYaml", () => {
  test("returns true for CNCF format with document + do", () => {
    const yaml = `
document:
  dsl: "1.0.0"
  namespace: test
  name: my-workflow
  version: "1.0.0"
do:
  - task_one:
      call: agent
      with:
        agent: my-agent
        message: hello
`;
    expect(isCncfWorkflowYaml(yaml)).toBe(true);
  });

  test("returns false for Stigmer native format", () => {
    const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: my-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: my-workflow
    version: "1.0.0"
  tasks:
    - name: task_one
      kind: agent_call
      task_config:
        agent: my-agent
`;
    expect(isCncfWorkflowYaml(yaml)).toBe(false);
  });

  test("returns false for invalid YAML", () => {
    expect(isCncfWorkflowYaml("{{invalid")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cncfYamlToGraph — basic structure
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph", () => {
  const MINIMAL_YAML = `
document:
  dsl: "1.0.0"
  namespace: acme
  name: simple-workflow
  version: "0.1.0"
do:
  - greet:
      call: agent
      with:
        agent: greeter
        message: hello
`;

  test("parses document metadata", () => {
    const graph = cncfYamlToGraph(MINIMAL_YAML);
    expect(graph.document).toEqual({
      dsl: "1.0.0",
      namespace: "acme",
      name: "simple-workflow",
      version: "0.1.0",
    });
  });

  test("creates Start + task + End nodes", () => {
    const graph = cncfYamlToGraph(MINIMAL_YAML);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].id).toBe(START_NODE_ID);
    expect(graph.nodes[1].id).toBe("greet");
    expect(graph.nodes[2].id).toBe(END_NODE_ID);
  });

  test("creates edges: start -> task -> end", () => {
    const graph = cncfYamlToGraph(MINIMAL_YAML);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ source: START_NODE_ID, target: "greet" });
    expect(graph.edges[1]).toMatchObject({ source: "greet", target: END_NODE_ID });
  });

  test("throws on missing document", () => {
    const yaml = `do:\n  - t: { call: agent_call, with: {} }`;
    expect(() => cncfYamlToGraph(yaml)).toThrow("document");
  });

  test("throws on missing do list", () => {
    const yaml = `document:\n  dsl: "1.0.0"\n  name: x\n  namespace: y\n  version: "1"`;
    expect(() => cncfYamlToGraph(yaml)).toThrow("do");
  });
});

// ---------------------------------------------------------------------------
// agent_call tasks
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — agent_call", () => {
  test("parses agent_call kind and config from with (CNCF uses call: agent)", () => {
    const yaml = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - analyze:
      call: agent
      with:
        agent: analyst
        message: run analysis
        config:
          model: claude-sonnet-4
          timeout: 300
      export:
        as: "\${ .structured }"
      then: summarize
  - summarize:
      call: agent
      with:
        agent: summarizer
        message: summarize results
`;
    const graph = cncfYamlToGraph(yaml);
    const analyzeNode = graph.nodes.find((n) => n.id === "analyze")!;
    expect(analyzeNode.kind).toBe(WorkflowTaskKind.agent_call);
    expect(analyzeNode.config).toMatchObject({ agent: "analyst", message: "run analysis" });
    expect(analyzeNode.export).toEqual({ as: "${ .structured }" });
    expect(analyzeNode.flow).toEqual({ then: "summarize" });

    // Edge from analyze -> summarize (explicit then)
    const edges = graph.edges.filter((e) => e.source === "analyze");
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("summarize");
  });
});

// ---------------------------------------------------------------------------
// switch_case tasks
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — switch_case", () => {
  const SWITCH_YAML = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - decision:
      switch:
        - approved:
            when: "\${ ctx.outcome == 'approve' }"
            then: notify_approved
        - rejected:
            then: notify_rejected
  - notify_approved:
      call: emit_event
      with:
        event:
          type: approved
  - notify_rejected:
      call: emit_event
      with:
        event:
          type: rejected
`;

  test("parses switch_case kind", () => {
    const graph = cncfYamlToGraph(SWITCH_YAML);
    const node = graph.nodes.find((n) => n.id === "decision")!;
    expect(node.kind).toBe(WorkflowTaskKind.switch_case);
  });

  test("creates labeled edges for each case branch", () => {
    const graph = cncfYamlToGraph(SWITCH_YAML);
    const edges = graph.edges.filter((e) => e.source === "decision");
    expect(edges).toHaveLength(2);

    const approvedEdge = edges.find((e) => e.label === "approved")!;
    expect(approvedEdge.target).toBe("notify_approved");
    expect(approvedEdge.sourceHandle).toBe("case_approved");

    const rejectedEdge = edges.find((e) => e.label === "rejected")!;
    expect(rejectedEdge.target).toBe("notify_rejected");
    expect(rejectedEdge.sourceHandle).toBe("case_rejected");
  });
});

// ---------------------------------------------------------------------------
// human_input tasks
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — human_input", () => {
  const HUMAN_INPUT_YAML = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - review:
      call: human_input
      with:
        prompt: "Review the plan"
        outcomes:
          - name: approve
            label: Approve
            then: do_approved
          - name: reject
            label: Reject
            then: do_rejected
  - do_approved:
      call: agent
      with:
        agent: a
        message: approved
  - do_rejected:
      call: agent
      with:
        agent: b
        message: rejected
`;

  test("parses human_input kind", () => {
    const graph = cncfYamlToGraph(HUMAN_INPUT_YAML);
    const node = graph.nodes.find((n) => n.id === "review")!;
    expect(node.kind).toBe(WorkflowTaskKind.human_input);
  });

  test("creates outcome edges with sourceHandle", () => {
    const graph = cncfYamlToGraph(HUMAN_INPUT_YAML);
    const edges = graph.edges.filter((e) => e.source === "review");
    expect(edges).toHaveLength(2);

    const approveEdge = edges.find((e) => e.label === "approve")!;
    expect(approveEdge.target).toBe("do_approved");
    expect(approveEdge.sourceHandle).toBe("outcome_approve");

    const rejectEdge = edges.find((e) => e.label === "reject")!;
    expect(rejectEdge.target).toBe("do_rejected");
    expect(rejectEdge.sourceHandle).toBe("outcome_reject");
  });
});

// ---------------------------------------------------------------------------
// emit_event tasks
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — emit_event", () => {
  test("parses emit_event kind and config", () => {
    const yaml = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - notify:
      call: emit_event
      with:
        event:
          type: notification.sent
          subject: test
          data:
            channel: slack
`;
    const graph = cncfYamlToGraph(yaml);
    const node = graph.nodes.find((n) => n.id === "notify")!;
    expect(node.kind).toBe(WorkflowTaskKind.emit_event);
    expect(node.config).toMatchObject({
      event: { type: "notification.sent", subject: "test" },
    });
  });
});

// ---------------------------------------------------------------------------
// fork tasks
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — fork", () => {
  test("parses fork kind", () => {
    const yaml = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - parallel_work:
      fork:
        branches:
          - branch_a:
              call: agent
              with:
                agent: a
                message: do a
          - branch_b:
              call: agent
              with:
                agent: b
                message: do b
        compete: true
`;
    const graph = cncfYamlToGraph(yaml);
    const node = graph.nodes.find((n) => n.id === "parallel_work")!;
    expect(node.kind).toBe(WorkflowTaskKind.fork);
  });
});

// ---------------------------------------------------------------------------
// for_each tasks
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — for_each", () => {
  test("parses for_each kind", () => {
    const yaml = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - process_items:
      for:
        each: item
        in: "\${ .items }"
      do:
        - handle:
            call: agent
            with:
              agent: handler
              message: handle item
`;
    const graph = cncfYamlToGraph(yaml);
    const node = graph.nodes.find((n) => n.id === "process_items")!;
    expect(node.kind).toBe(WorkflowTaskKind.for_each);
  });
});

// ---------------------------------------------------------------------------
// Sequential flow (implicit ordering)
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — sequential flow", () => {
  test("creates sequential edges when no explicit then", () => {
    const yaml = `
document:
  dsl: "1.0.0"
  namespace: ns
  name: wf
  version: "1.0.0"
do:
  - step_1:
      call: agent
      with:
        agent: a
        message: one
  - step_2:
      call: agent
      with:
        agent: b
        message: two
  - step_3:
      call: agent
      with:
        agent: c
        message: three
`;
    const graph = cncfYamlToGraph(yaml);

    const taskEdges = graph.edges.filter((e) => e.source !== START_NODE_ID);
    expect(taskEdges).toHaveLength(3);
    expect(taskEdges[0]).toMatchObject({ source: "step_1", target: "step_2" });
    expect(taskEdges[1]).toMatchObject({ source: "step_2", target: "step_3" });
    expect(taskEdges[2]).toMatchObject({ source: "step_3", target: END_NODE_ID });
  });
});

// ---------------------------------------------------------------------------
// Full daily-notification-plan-like workflow
// ---------------------------------------------------------------------------

describe("cncfYamlToGraph — complex workflow (daily-notification-plan pattern)", () => {
  const COMPLEX_YAML = `
document:
  dsl: "1.0.0"
  namespace: tt-demo
  name: daily-notification-plan
  version: "1.0.0"
do:
  - analyze_player_data:
      call: agent
      with:
        agent: notification-analyst
        message: Generate the daily cohort analysis report.
      export:
        as: "\${ .structured }"
      then: design_notification_campaigns
  - design_notification_campaigns:
      call: agent
      with:
        agent: notification-creative-strategist
        message: Design push notification campaigns.
      export:
        as: "\${ .structured }"
      then: validate_deployment_readiness
  - validate_deployment_readiness:
      call: agent
      with:
        agent: notification-engineer
        message: Validate deployment feasibility.
      export:
        as: "\${ .structured }"
      then: compile_daily_plan
  - compile_daily_plan:
      call: agent
      with:
        agent: notification-coordinator
        message: Synthesize specialist outputs.
      export:
        as: "\${ . }"
      then: team_lead_review
  - team_lead_review:
      call: human_input
      with:
        prompt: "Review today's daily notification plan."
        outcomes:
          - name: approve
            label: Approve Plan
          - name: reject
            label: Reject Plan
      export:
        as: "\${ . }"
      then: approval_gate
  - approval_gate:
      switch:
        - approved:
            when: "\${ $context.team_lead_review.outcome == 'approve' }"
            then: notify_plan_approved
        - rejected:
            then: notify_plan_rejected
  - notify_plan_approved:
      call: emit_event
      with:
        event:
          type: tt-demo.notification.daily-plan.approved
          subject: daily-notification-plan
      export:
        as: "\${ . }"
  - notify_plan_rejected:
      call: emit_event
      with:
        event:
          type: tt-demo.notification.daily-plan.rejected
          subject: daily-notification-plan
      export:
        as: "\${ . }"
`;

  test("produces correct node count (Start + 8 tasks + End)", () => {
    const graph = cncfYamlToGraph(COMPLEX_YAML);
    expect(graph.nodes).toHaveLength(10);
  });

  test("all task nodes have correct kinds", () => {
    const graph = cncfYamlToGraph(COMPLEX_YAML);
    const taskNodes = graph.nodes.filter((n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID);

    expect(taskNodes.find((n) => n.id === "analyze_player_data")!.kind).toBe(WorkflowTaskKind.agent_call);
    expect(taskNodes.find((n) => n.id === "team_lead_review")!.kind).toBe(WorkflowTaskKind.human_input);
    expect(taskNodes.find((n) => n.id === "approval_gate")!.kind).toBe(WorkflowTaskKind.switch_case);
    expect(taskNodes.find((n) => n.id === "notify_plan_approved")!.kind).toBe(WorkflowTaskKind.emit_event);
    expect(taskNodes.find((n) => n.id === "notify_plan_rejected")!.kind).toBe(WorkflowTaskKind.emit_event);
  });

  test("explicit then edges form the main chain", () => {
    const graph = cncfYamlToGraph(COMPLEX_YAML);
    const findEdge = (src: string, tgt: string) =>
      graph.edges.find((e) => e.source === src && e.target === tgt);

    expect(findEdge("analyze_player_data", "design_notification_campaigns")).toBeTruthy();
    expect(findEdge("design_notification_campaigns", "validate_deployment_readiness")).toBeTruthy();
    expect(findEdge("validate_deployment_readiness", "compile_daily_plan")).toBeTruthy();
    expect(findEdge("compile_daily_plan", "team_lead_review")).toBeTruthy();
    expect(findEdge("team_lead_review", "approval_gate")).toBeTruthy();
  });

  test("switch case creates branching edges", () => {
    const graph = cncfYamlToGraph(COMPLEX_YAML);
    const switchEdges = graph.edges.filter((e) => e.source === "approval_gate");
    expect(switchEdges).toHaveLength(2);
    expect(switchEdges.find((e) => e.target === "notify_plan_approved")).toBeTruthy();
    expect(switchEdges.find((e) => e.target === "notify_plan_rejected")).toBeTruthy();
  });

  test("last task connects to End (sequential fallthrough for non-terminal tasks)", () => {
    const graph = cncfYamlToGraph(COMPLEX_YAML);
    const endEdges = graph.edges.filter((e) => e.target === END_NODE_ID);
    expect(endEdges).toHaveLength(1);
    expect(endEdges[0].source).toBe("notify_plan_rejected");

    // notify_plan_approved has no explicit `then` and is not the last task,
    // so it gets a sequential edge to notify_plan_rejected (same as yamlToGraph behavior)
    const approvedEdges = graph.edges.filter((e) => e.source === "notify_plan_approved");
    expect(approvedEdges).toHaveLength(1);
    expect(approvedEdges[0].target).toBe("notify_plan_rejected");
  });
});
