# Workflow Examples

Complete, validated examples ordered from simplest to most involved. Each one
passes `validate_workflow_yaml`. Use them as starting templates, but always
re-validate after editing and verify any referenced resources exist.

## 1. Linear LLM pipeline with a transform

A two-task workflow: analyze input, then reshape the result. Demonstrates `env`
inputs, `budget`, `llm_call`, `transform` (JQ), and `${ ... }` expressions.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: quick-analysis
  org: acme
spec:
  document:
    dsl: "1.0.0"
    namespace: acme
    name: quick-analysis
    version: "1.0.0"
  env:
    SOURCE_MATERIAL:
      description: "Text to analyze (paste content directly)"
  budget:
    max_cost_micros: 1000000
    max_duration_seconds: 300
  tasks:
    - name: analyze
      kind: llm_call
      task_config:
        model: "claude-sonnet-4.5"
        system_prompt: "You are a research analyst. Identify key themes and gaps."
        prompt: >
          Analyze the following material:

          ${ $context.env.SOURCE_MATERIAL }
        temperature: 0.3
        max_tokens: 1500
        timeout: 120
        max_retries: 2
      export:
        as: "${ . }"
      flow:
        then: shape_result
    - name: shape_result
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          { analysis: .text, word_count: (.text | length) }
        input: "${ $context.analyze }"
      export:
        as: "${ . }"
```

## 2. Structured output + switch_case branching + approval gate

Classify a ticket into structured JSON, branch on severity, and require human
approval for critical cases. Demonstrates `response_schema` with `on_invalid`,
`switch_case`, `human_input` with multiple `outcomes`, and converging branches.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: ticket-triage
  org: acme
spec:
  document:
    dsl: "1.0.0"
    namespace: acme
    name: ticket-triage
    version: "1.0.0"
  env:
    TICKET_DESCRIPTION:
      description: "The support ticket text to triage"
  budget:
    max_cost_micros: 500000
    max_duration_seconds: 300
  tasks:
    - name: classify_ticket
      kind: llm_call
      task_config:
        model: "gpt-4o-mini"
        system_prompt: "Classify the ticket by severity. Be conservative with critical."
        prompt: "Classify this ticket:\n\n${ $context.env.TICKET_DESCRIPTION }"
        response_schema:
          type: object
          required:
            - severity
            - summary
          properties:
            severity:
              type: string
              enum:
                - low
                - medium
                - high
                - critical
            summary:
              type: string
        on_invalid: ON_INVALID_RETRY
        max_retries: 2
        max_tokens: 400
        timeout: 60
      export:
        as: "${ .structured }"
      flow:
        then: route_by_severity

    - name: route_by_severity
      kind: switch_case
      task_config:
        cases:
          - name: critical
            when: "${ $context.classify_ticket.severity == 'critical' }"
            then: escalation_approval
          - name: default
            then: build_summary

    - name: escalation_approval
      kind: human_input
      task_config:
        prompt: >
          CRITICAL ticket needs escalation approval.

          Summary: ${ $context.classify_ticket.summary }
        outcomes:
          - name: approve
            label: "Approve Escalation"
          - name: reject
            label: "Not an Incident"
            then: build_summary
        timeout: 3600
        on_timeout: HUMAN_INPUT_TIMEOUT_FAIL
      export:
        as: "${ . }"
      flow:
        then: build_summary

    - name: build_summary
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          { severity: .severity, summary: .summary, status: "triaged" }
        input: "${ $context.classify_ticket }"
      export:
        as: "${ . }"
```

## 3. Parallel fan-out with fork

Run two analyses in parallel, then merge. Demonstrates `fork` with `compete: false`
and reading branch outputs in a downstream `transform`.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: parallel-summary
  org: acme
spec:
  document:
    dsl: "1.0.0"
    namespace: acme
    name: parallel-summary
    version: "1.0.0"
  env:
    SOURCE_MATERIAL:
      description: "Material to analyze"
  budget:
    max_cost_micros: 2000000
    max_duration_seconds: 600
  tasks:
    - name: parallel_processing
      kind: fork
      task_config:
        compete: false
        branches:
          - name: executive_summary
            do:
              - name: summarize
                kind: llm_call
                task_config:
                  model: "claude-sonnet-4.5"
                  system_prompt: "Write a concise executive summary."
                  prompt: "Summarize:\n\n${ $context.env.SOURCE_MATERIAL }"
                  max_tokens: 500
                  timeout: 60
                export:
                  as: "${ . }"
          - name: key_findings
            do:
              - name: extract_findings
                kind: llm_call
                task_config:
                  model: "gpt-4o-mini"
                  system_prompt: "Extract key findings."
                  prompt: "Extract findings:\n\n${ $context.env.SOURCE_MATERIAL }"
                  max_tokens: 500
                  timeout: 60
                export:
                  as: "${ . }"
      export:
        as: "${ . }"
      flow:
        then: merge_results
    - name: merge_results
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          { summary: .summary, findings: .findings }
        input: "${ {summary: $context.parallel_processing.executive_summary.summarize.text, findings: $context.parallel_processing.key_findings.extract_findings.text} }"
      export:
        as: "${ . }"
```

## 4. Multi-agent orchestration with approval + event emission

The core "team of specialists" pattern: chain `agent_call` tasks that hand
structured output to each other, gate on a `human_input` approval, branch on the
outcome with `switch_case`, and terminate with `emit_event`. Each agent must
already exist on the platform (verify with `get_agent`).

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: daily-plan
  org: acme
spec:
  document:
    dsl: "1.0.0"
    namespace: acme
    name: daily-plan
    version: "1.0.0"
  env:
    POSTGRES_CONNECTION_URL:
      is_secret: true
      description: "Connection URL for the analytics database"
  budget:
    max_cost_micros: 5000000
    max_duration_seconds: 1800
  tasks:
    - name: analyze_data
      kind: agent_call
      task_config:
        agent: "data-analyst"
        message: "Produce today's cohort analysis report."
        output:
          schema:
            type: object
            required:
              - executive_summary
            properties:
              executive_summary:
                type: string
          on_invalid: ON_INVALID_RETRY
          max_retries: 1
        config:
          timeout: 300
      export:
        as: "${ .structured }"
      flow:
        then: compile_plan

    - name: compile_plan
      kind: agent_call
      task_config:
        agent: "coordinator"
        message: >
          Synthesize this report into a proposal:
          ${ $context.analyze_data.executive_summary }
        config:
          timeout: 180
      export:
        as: "${ . }"
      flow:
        then: review_plan

    - name: review_plan
      kind: human_input
      task_config:
        prompt: "Review today's plan:\n\n${ $context.compile_plan.final_text }"
        outcomes:
          - name: approve
            label: "Approve Plan"
          - name: reject
            label: "Reject Plan"
        approvers:
          - "user:owner"
      export:
        as: "${ . }"
      flow:
        then: approval_gate

    - name: approval_gate
      kind: switch_case
      task_config:
        cases:
          - name: approved
            when: "${ $context.review_plan.outcome == 'approve' }"
            then: notify_approved
          - name: rejected
            then: notify_rejected

    - name: notify_approved
      kind: emit_event
      task_config:
        event:
          type: "acme.daily-plan.approved"
          subject: "daily-plan"
          data:
            approved_by: "${ $context.review_plan.reviewer }"
            body: "Daily plan approved. Proceed with deployment."
      export:
        as: "${ . }"

    - name: notify_rejected
      kind: emit_event
      task_config:
        event:
          type: "acme.daily-plan.rejected"
          subject: "daily-plan"
          data:
            rejected_by: "${ $context.review_plan.reviewer }"
            body: "Daily plan rejected. No action today."
      export:
        as: "${ . }"
```

## Notes on these examples

- Model names (`claude-sonnet-4.5`, `gpt-4o-mini`) are illustrative — use models
  available on the target platform.
- Agent slugs (`data-analyst`, `coordinator`) are illustrative — verify real slugs
  with `get_agent` before referencing them.
- After adapting any example, run `validate_workflow_yaml` and only then
  `stigmer apply -f <file>.yaml`.
