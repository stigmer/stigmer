import type { ResourceTemplate } from "./types";

/**
 * Data payload for workflow templates.
 *
 * Unlike agent templates (form fields), workflow templates carry
 * the full YAML string. The editor opens with this as `initialYaml`.
 */
export interface WorkflowTemplateData {
  readonly yaml: string;
}

/**
 * Built-in workflow templates shipped with the SDK.
 *
 * Each template provides a complete, valid workflow YAML that
 * demonstrates a distinct structural pattern. Users customize
 * everything in the editor after selection.
 *
 * The first 3 templates are the same workflows shipped in the
 * seedpack — included here so the gallery works offline and
 * without server bootstrap.
 *
 * Platform builders can pass their own template arrays to the
 * gallery; these built-in templates are a convenience default.
 */
export const WORKFLOW_TEMPLATES: readonly ResourceTemplate<WorkflowTemplateData>[] =
  [
    // -----------------------------------------------------------------------
    // 1. Research & Summarize (seedpack)
    // Pattern: fork/parallel + HITL approval + structured extraction
    // -----------------------------------------------------------------------
    {
      id: "research-and-summarize",
      name: "Research & Summarize",
      description:
        "Multi-step AI analysis with parallel processing and human approval. An LLM analyzes source material, then two branches simultaneously generate a summary and extract structured findings. Results merge for human review.",
      category: "data-analysis",
      tags: [
        "research",
        "analysis",
        "parallel",
        "fork",
        "human-approval",
        "structured-output",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: research-and-summarize
spec:
  description: >
    Multi-step AI analysis pipeline with parallel processing and human approval.
    An LLM analyzes source material, then two parallel branches simultaneously
    generate an executive summary and extract structured key findings.
    Results are merged and presented for human review before finalization.
  document:
    dsl: "1.0.0"
    namespace: default
    name: research-and-summarize
    version: "1.0.0"
  env:
    TOPIC:
      description: "The topic or question to analyze"
    SOURCE_MATERIAL:
      description: "Text, article, or data to analyze (paste content directly)"
    DEPTH:
      description: "Analysis depth: brief, standard, or thorough (default: standard)"
      optional: true
  budget:
    max_cost_micros: 3000000
    max_total_tokens: 300000
    max_duration_seconds: 600
  tasks:
    - name: initial_analysis
      kind: llm_call
      task_config:
        model: "claude-sonnet-4-5"
        system_prompt: >
          You are a research analyst. Analyze the provided source material
          thoroughly. Identify key themes, claims, evidence, and gaps.
          Organize your analysis with clear sections.
        prompt: >
          Analyze the following material on "\${ $env.TOPIC }"
          at \${ $env.DEPTH } depth:

          \${ $env.SOURCE_MATERIAL }
        temperature: 0.3
        max_tokens: 3000
        timeout: 120
        max_retries: 2
      export:
        as: "\${ . }"
      flow:
        then: parallel_processing

    - name: parallel_processing
      kind: fork
      task_config:
        branches:
          - name: executive_summary
            do:
              - name: summarize
                kind: llm_call
                task_config:
                  model: "claude-sonnet-4-5"
                  system_prompt: >
                    You are an executive briefing writer. Distill analysis
                    into a concise, actionable summary for decision-makers.
                  prompt: >
                    Write a 3-paragraph executive summary of this analysis:

                    \${ $context.initial_analysis.text }
                  temperature: 0.3
                  max_tokens: 500
                  timeout: 60
                export:
                  as: "\${ . }"
          - name: key_findings
            do:
              - name: extract_findings
                kind: llm_call
                task_config:
                  model: "gpt-4o-mini"
                  system_prompt: "Extract structured key findings from the analysis."
                  prompt: >
                    Extract the key findings from this analysis as structured data:

                    \${ $context.initial_analysis.text }
                  response_schema:
                    type: object
                    required:
                      - findings
                      - confidence
                    properties:
                      findings:
                        type: array
                        items:
                          type: object
                          required:
                            - title
                            - detail
                          properties:
                            title:
                              type: string
                            detail:
                              type: string
                      confidence:
                        type: string
                        enum:
                          - low
                          - medium
                          - high
                  on_invalid: ON_INVALID_RETRY
                  max_retries: 2
                  max_tokens: 500
                  timeout: 60
                export:
                  as: "\${ . }"
        compete: false
      export:
        as: "\${ . }"
      flow:
        then: merge_results

    - name: merge_results
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            topic: .topic,
            executive_summary: .summary,
            key_findings: .findings,
            finding_count: (.findings.findings | length)
          }
        input: "\${ {topic: $env.TOPIC, summary: $context.parallel_processing.executive_summary.summarize.text, findings: $context.parallel_processing.key_findings.extract_findings.structured} }"
      export:
        as: "\${ . }"
      flow:
        then: review_report

    - name: review_report
      kind: human_input
      task_config:
        prompt: >
          Review the analysis report for "\${ $context.merge_results.topic }".

          --- Executive Summary ---
          \${ $context.merge_results.executive_summary }

          --- Key Findings (\${ $context.merge_results.finding_count } items) ---
          Confidence: \${ $context.merge_results.key_findings.confidence }

          Approve this report?
        form_schema:
          type: object
          properties:
            notes:
              type: string
              description: "Optional reviewer notes or corrections"
        outcomes:
          - name: approve
            label: "Approve Report"
          - name: reject
            label: "Discard"
            then: end
        timeout: 172800
        on_timeout: HUMAN_INPUT_TIMEOUT_FAIL
      export:
        as: "\${ . }"
      flow:
        then: finalize_report

    - name: finalize_report
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: "approved",
            topic: .report.topic,
            executive_summary: .report.executive_summary,
            key_findings: .report.key_findings,
            approved_by: .review.reviewer,
            reviewer_notes: .review.form_data.notes
          }
        input: "\${ {report: $context.merge_results, review: $context.review_report} }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 2. Support Ticket Triage (seedpack)
    // Pattern: switch_case branching + structured LLM output + HITL escalation
    // -----------------------------------------------------------------------
    {
      id: "support-ticket-triage",
      name: "Support Ticket Triage",
      description:
        "Automated support ticket classification and routing using structured LLM output. Classifies tickets by severity, then routes critical ones through human approval before escalation.",
      category: "customer-support",
      tags: [
        "support",
        "triage",
        "classification",
        "routing",
        "switch",
        "structured-output",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: support-ticket-triage
spec:
  description: >
    Automated support ticket classification and routing using structured LLM output.
    An LLM classifies incoming tickets by severity and category, then a switch
    routes to different handling paths. Critical tickets go through human approval
    before escalation; standard tickets are auto-routed.
  document:
    dsl: "1.0.0"
    namespace: default
    name: support-ticket-triage
    version: "1.0.0"
  env:
    TICKET_DESCRIPTION:
      description: "The support ticket text to triage"
    CUSTOMER_EMAIL:
      description: "Customer email for follow-up (optional)"
      optional: true
  budget:
    max_cost_micros: 500000
    max_duration_seconds: 300
  tasks:
    - name: classify_ticket
      kind: llm_call
      task_config:
        model: "gpt-4o-mini"
        system_prompt: >
          You are a support ticket classifier. Analyze the ticket and classify
          it by severity and category. Be conservative with critical/high
          severity — only use those for genuine service disruptions or data loss.
        prompt: >
          Classify this support ticket:

          \${ $env.TICKET_DESCRIPTION }

          Customer: \${ $env.CUSTOMER_EMAIL }
        response_schema:
          type: object
          required:
            - severity
            - category
            - summary
          properties:
            severity:
              type: string
              enum:
                - low
                - medium
                - high
                - critical
            category:
              type: string
              enum:
                - bug
                - feature_request
                - account
                - billing
                - integration
                - general
            summary:
              type: string
            customer_impact:
              type: boolean
        on_invalid: ON_INVALID_RETRY
        max_retries: 2
        max_tokens: 500
        timeout: 60
      export:
        as: "\${ .structured }"
      flow:
        then: route_by_severity

    - name: route_by_severity
      kind: switch_case
      task_config:
        cases:
          - name: critical
            when: "\${ $context.classify_ticket.severity == 'critical' }"
            then: escalation_approval
          - name: high
            when: "\${ $context.classify_ticket.severity == 'high' }"
            then: build_high_summary
          - name: default
            then: build_standard_summary

    - name: escalation_approval
      kind: human_input
      task_config:
        prompt: >
          A ticket has been classified as CRITICAL and needs escalation approval.

          *Summary*: \${ $context.classify_ticket.summary }
          *Category*: \${ $context.classify_ticket.category }

          Approve escalation to the incident response team?
        outcomes:
          - name: approve
            label: "Approve Escalation"
          - name: downgrade
            label: "Downgrade to High"
            then: build_high_summary
          - name: reject
            label: "Not an Incident"
            then: build_standard_summary
        timeout: 3600
        on_timeout: HUMAN_INPUT_TIMEOUT_FAIL
      export:
        as: "\${ . }"
      flow:
        then: build_escalation_summary

    - name: build_escalation_summary
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: "escalated",
            severity: "critical",
            category: .classification.category,
            summary: .classification.summary,
            action: "Route to incident response team"
          }
        input: "\${ {classification: $context.classify_ticket, approval: $context.escalation_approval} }"
      export:
        as: "\${ . }"

    - name: build_high_summary
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: "triaged",
            severity: .severity,
            category: .category,
            summary: .summary,
            action: "Route to senior support queue"
          }
        input: "\${ $context.classify_ticket }"
      export:
        as: "\${ . }"

    - name: build_standard_summary
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: "triaged",
            severity: .severity,
            category: .category,
            summary: .summary,
            action: "Route to standard support queue"
          }
        input: "\${ $context.classify_ticket }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 3. Content Review Pipeline (seedpack)
    // Pattern: revision loop (HITL → revise → HITL)
    // -----------------------------------------------------------------------
    {
      id: "content-review-pipeline",
      name: "Content Review Pipeline",
      description:
        "AI-powered content drafting with human-in-the-loop review. The reviewer can approve, request revisions (which loops back to the LLM with feedback), or reject outright.",
      category: "content",
      tags: [
        "content",
        "writing",
        "review",
        "revision",
        "loop",
        "human-approval",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: content-review-pipeline
spec:
  description: >
    AI-powered content drafting with human-in-the-loop review.
    An LLM drafts content based on a topic and guidelines, then pauses
    for human approval. The reviewer can approve, request revisions
    (which loops back to the LLM with feedback), or reject outright.
  document:
    dsl: "1.0.0"
    namespace: default
    name: content-review-pipeline
    version: "1.0.0"
  env:
    TOPIC:
      description: "The topic or subject to write about"
    GUIDELINES:
      description: "Style guidelines or constraints for the content (optional)"
      optional: true
  budget:
    max_cost_micros: 2000000
    max_duration_seconds: 600
  tasks:
    - name: draft_content
      kind: llm_call
      task_config:
        model: "claude-sonnet-4-5"
        system_prompt: >
          You are a professional content writer. Write clear, engaging content
          that follows the provided guidelines.
        prompt: >
          Write content about the following topic: \${ $env.TOPIC }

          Guidelines: \${ $env.GUIDELINES }
        temperature: 0.7
        max_tokens: 2000
        timeout: 120
        max_retries: 2
      export:
        as: "\${ . }"
      flow:
        then: review_content

    - name: review_content
      kind: human_input
      task_config:
        prompt: >
          Review the AI-drafted content below and decide whether to approve,
          request revisions, or reject it.

          --- Draft ---
          \${ $context.draft_content.text }
        form_schema:
          type: object
          properties:
            feedback:
              type: string
              description: "Revision notes (required if requesting revisions)"
        outcomes:
          - name: approve
            label: "Approve"
          - name: revise
            label: "Request Revisions"
            then: revise_content
          - name: reject
            label: "Reject"
            then: end
        timeout: 86400
        on_timeout: HUMAN_INPUT_TIMEOUT_FAIL
      export:
        as: "\${ . }"
      flow:
        then: finalize

    - name: revise_content
      kind: llm_call
      task_config:
        model: "claude-sonnet-4-5"
        system_prompt: >
          You are a professional content writer. Revise the draft based on
          the reviewer's feedback. Preserve what works, fix what doesn't.
        prompt: >
          Original topic: \${ $env.TOPIC }

          Previous draft:
          \${ $context.draft_content.text }

          Reviewer feedback:
          \${ $context.review_content.form_data.feedback }

          Please revise the draft to address the feedback.
        temperature: 0.5
        max_tokens: 2000
        timeout: 120
        max_retries: 2
      export:
        as: "\${ . }"
      flow:
        then: review_content

    - name: finalize
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: "approved",
            topic: .topic,
            content: .content,
            approved_by: .reviewer
          }
        input: "\${ {topic: $env.TOPIC, content: $context.draft_content.text, reviewer: $context.review_content.reviewer} }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 4. Batch Data Enrichment (NEW)
    // Pattern: for_each + HTTP integration
    // -----------------------------------------------------------------------
    {
      id: "batch-data-enrichment",
      name: "Batch Data Enrichment",
      description:
        "Process a collection of items through an enrichment API using for_each iteration. Each item is sent to an HTTP endpoint, transformed, and the results are aggregated.",
      category: "integration",
      tags: [
        "batch",
        "for-each",
        "enrichment",
        "http",
        "api",
        "data-processing",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: batch-data-enrichment
spec:
  description: >
    Process a collection of items through an enrichment API using for_each.
    Demonstrates batch processing, HTTP integration, data transformation,
    and variable management for aggregated results.
  document:
    dsl: "1.0.0"
    namespace: default
    name: batch-data-enrichment
    version: "1.0.0"
  env:
    ENRICHMENT_API_URL:
      description: "Base URL of the enrichment API endpoint"
    API_KEY:
      description: "API key for the enrichment service"
      is_secret: true
    ITEMS_JSON:
      description: 'JSON array of items to enrich, e.g. [{"id": 1, "name": "Acme"}]'
  budget:
    max_cost_micros: 1000000
    max_duration_seconds: 900
  tasks:
    - name: prepare_batch
      kind: set_vars
      task_config:
        vars:
          items: "\${ $env.ITEMS_JSON }"
          processed_count: 0
          failed_count: 0
      export:
        as: "\${ . }"
      flow:
        then: enrich_items

    - name: enrich_items
      kind: for_each
      task_config:
        collection: "\${ $context.prepare_batch.items }"
        as: item
        do:
          - name: call_api
            kind: http_call
            task_config:
              method: POST
              url: "\${ $env.ENRICHMENT_API_URL }/enrich"
              headers:
                Authorization: "Bearer \${ $env.API_KEY }"
                Content-Type: "application/json"
              body: "\${ $item }"
              timeout: 30
              max_retries: 2
            export:
              as: "\${ . }"
          - name: transform_result
            kind: transform
            task_config:
              engine: TRANSFORM_ENGINE_JQ
              expression: >
                {
                  id: .original.id,
                  name: .original.name,
                  enriched: .response.body,
                  enriched_at: now | todate
                }
              input: "\${ {original: $item, response: $context.call_api} }"
            export:
              as: "\${ . }"
      export:
        as: "\${ . }"
      flow:
        then: build_summary

    - name: build_summary
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: "completed",
            total_items: (.results | length),
            results: .results
          }
        input: "\${ {results: $context.enrich_items} }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 5. Multi-Agent Pipeline (NEW)
    // Pattern: agent chaining with structured handoff
    // -----------------------------------------------------------------------
    {
      id: "multi-agent-pipeline",
      name: "Multi-Agent Pipeline",
      description:
        "Chain multiple specialized agents in sequence, with each agent's structured output feeding the next. Demonstrates agent orchestration with structured handoffs and a final synthesis step.",
      category: "data-analysis",
      tags: [
        "multi-agent",
        "pipeline",
        "agent-call",
        "structured-output",
        "orchestration",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: multi-agent-pipeline
spec:
  description: >
    Chain multiple specialized agents where each agent's structured output
    feeds the next. A researcher gathers information, an analyst evaluates it,
    and a writer produces the final deliverable.
  document:
    dsl: "1.0.0"
    namespace: default
    name: multi-agent-pipeline
    version: "1.0.0"
  env:
    OBJECTIVE:
      description: "The research objective or question to investigate"
    OUTPUT_FORMAT:
      description: "Desired output format: report, brief, or memo (default: report)"
      optional: true
  budget:
    max_cost_micros: 5000000
    max_total_tokens: 500000
    max_duration_seconds: 1200
  tasks:
    - name: research
      kind: agent_call
      task_config:
        agent: "org/research-agent"
        message: >
          Research the following objective thoroughly:

          \${ $env.OBJECTIVE }

          Gather key facts, data points, and source references.
          Provide a structured research brief.
        output:
          schema:
            type: object
            required:
              - findings
              - sources
            properties:
              findings:
                type: array
                items:
                  type: object
                  properties:
                    claim:
                      type: string
                    evidence:
                      type: string
                    confidence:
                      type: string
              sources:
                type: array
                items:
                  type: string
              gaps:
                type: array
                items:
                  type: string
          on_invalid: ON_INVALID_RETRY
          max_retries: 1
        config:
          timeout: 300
      export:
        as: "\${ .structured }"
      flow:
        then: analyze

    - name: analyze
      kind: agent_call
      task_config:
        agent: "org/data-analyst-agent"
        message: >
          Analyze the following research findings and provide a critical assessment:

          Findings: \${ $context.research.findings }
          Sources: \${ $context.research.sources }
          Gaps: \${ $context.research.gaps }

          Evaluate the strength of evidence, identify contradictions,
          and rate overall confidence.
        output:
          schema:
            type: object
            required:
              - assessment
              - confidence_rating
            properties:
              assessment:
                type: string
              confidence_rating:
                type: string
                enum:
                  - low
                  - medium
                  - high
              key_insights:
                type: array
                items:
                  type: string
              risks:
                type: array
                items:
                  type: string
          on_invalid: ON_INVALID_RETRY
          max_retries: 1
        config:
          timeout: 300
      export:
        as: "\${ .structured }"
      flow:
        then: synthesize

    - name: synthesize
      kind: agent_call
      task_config:
        agent: "org/docs-agent"
        message: >
          Write a \${ $env.OUTPUT_FORMAT } based on:

          Research findings: \${ $context.research.findings }
          Analysis: \${ $context.analyze.assessment }
          Confidence: \${ $context.analyze.confidence_rating }
          Key insights: \${ $context.analyze.key_insights }

          Make it clear, actionable, and well-structured.
        config:
          timeout: 300
      export:
        as: "\${ . }"
      flow:
        then: package_output

    - name: package_output
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            objective: .objective,
            confidence: .confidence,
            deliverable: .content,
            sources: .sources,
            risks: .risks
          }
        input: "\${ {objective: $env.OBJECTIVE, confidence: $context.analyze.confidence_rating, content: $context.synthesize.text, sources: $context.research.sources, risks: $context.analyze.risks} }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 6. Error-Resilient Integration (NEW)
    // Pattern: try_catch + retry + error notification
    // -----------------------------------------------------------------------
    {
      id: "error-resilient-integration",
      name: "Error-Resilient Integration",
      description:
        "Call an external API with robust error handling using try/catch. On failure, an LLM generates a user-friendly error summary and the workflow sets fallback variables instead of failing entirely.",
      category: "integration",
      tags: [
        "try-catch",
        "error-handling",
        "http",
        "resilient",
        "fallback",
        "retry",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: error-resilient-integration
spec:
  description: >
    Call an external API with robust error handling using try/catch.
    On failure, an LLM generates a user-friendly error summary and the
    workflow sets fallback variables instead of failing entirely.
    Demonstrates try_catch, http_call with retry, set_vars for fallback,
    and LLM-assisted error diagnosis.
  document:
    dsl: "1.0.0"
    namespace: default
    name: error-resilient-integration
    version: "1.0.0"
  env:
    API_ENDPOINT:
      description: "URL of the external API to call"
    API_KEY:
      description: "Authentication key for the API"
      is_secret: true
    REQUEST_BODY:
      description: "JSON request body to send"
      optional: true
  budget:
    max_cost_micros: 1000000
    max_duration_seconds: 300
  tasks:
    - name: initialize
      kind: set_vars
      task_config:
        vars:
          attempt_started_at: "\${ now | todate }"
          status: "pending"
      export:
        as: "\${ . }"
      flow:
        then: safe_api_call

    - name: safe_api_call
      kind: try_catch
      task_config:
        do:
          - name: call_external_api
            kind: http_call
            task_config:
              method: POST
              url: "\${ $env.API_ENDPOINT }"
              headers:
                Authorization: "Bearer \${ $env.API_KEY }"
                Content-Type: "application/json"
              body: "\${ $env.REQUEST_BODY }"
              timeout: 30
              max_retries: 3
            export:
              as: "\${ . }"
        catch:
          - name: on_error
            do:
              - name: diagnose_error
                kind: llm_call
                task_config:
                  model: "gpt-4o-mini"
                  system_prompt: >
                    You are an API integration specialist. Given an error from
                    an HTTP call, provide a brief, actionable diagnosis.
                  prompt: >
                    The following API call failed:
                    Endpoint: \${ $env.API_ENDPOINT }
                    Error: \${ $error.message }

                    Provide a one-paragraph diagnosis and suggested fix.
                  max_tokens: 200
                  timeout: 30
                export:
                  as: "\${ . }"
              - name: set_fallback
                kind: set_vars
                task_config:
                  vars:
                    api_result: null
                    error_diagnosis: "\${ $context.diagnose_error.text }"
                    status: "failed_with_fallback"
                export:
                  as: "\${ . }"
      export:
        as: "\${ . }"
      flow:
        then: build_result

    - name: build_result
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            status: (if .fallback then .fallback.status else "success" end),
            data: (if .api then .api.body else null end),
            error_diagnosis: (if .fallback then .fallback.error_diagnosis else null end),
            started_at: .started_at
          }
        input: "\${ {api: $context.call_external_api, fallback: $context.set_fallback, started_at: $context.initialize.attempt_started_at} }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 7. LLM Evaluation Pipeline (NEW)
    // Pattern: eval + validation + structured comparison
    // -----------------------------------------------------------------------
    {
      id: "llm-evaluation-pipeline",
      name: "LLM Evaluation Pipeline",
      description:
        "Evaluate LLM output quality using an LLM-as-judge pattern. Generate a response, validate its structure, then use a separate evaluator model to score quality, relevance, and safety.",
      category: "data-analysis",
      tags: [
        "eval",
        "evaluation",
        "llm-judge",
        "validation",
        "quality",
        "testing",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: llm-evaluation-pipeline
spec:
  description: >
    Evaluate LLM output quality using an LLM-as-judge pattern.
    Generate a response, validate its structure, then use a separate
    evaluator model to score quality, relevance, and safety.
    Demonstrates eval, llm_call, validate, and transform tasks.
  document:
    dsl: "1.0.0"
    namespace: default
    name: llm-evaluation-pipeline
    version: "1.0.0"
  env:
    PROMPT:
      description: "The prompt to evaluate the model on"
    EXPECTED_TOPICS:
      description: "Comma-separated list of topics the response should cover"
      optional: true
    MODEL_UNDER_TEST:
      description: "Model to evaluate (default: gpt-4o-mini)"
      optional: true
  budget:
    max_cost_micros: 2000000
    max_duration_seconds: 300
  tasks:
    - name: generate_response
      kind: llm_call
      task_config:
        model: "\${ $env.MODEL_UNDER_TEST }"
        prompt: "\${ $env.PROMPT }"
        temperature: 0.7
        max_tokens: 1000
        timeout: 60
      export:
        as: "\${ . }"
      flow:
        then: validate_structure

    - name: validate_structure
      kind: validate
      task_config:
        schema:
          type: object
          required:
            - text
          properties:
            text:
              type: string
              minLength: 10
        input: "\${ $context.generate_response }"
        on_invalid: ON_INVALID_CONTINUE
      export:
        as: "\${ . }"
      flow:
        then: evaluate_quality

    - name: evaluate_quality
      kind: eval
      task_config:
        evaluator_model: "claude-sonnet-4-5"
        criteria:
          - name: relevance
            description: "Does the response directly address the prompt?"
            scale: 1-5
          - name: completeness
            description: "Does the response cover the expected topics?"
            scale: 1-5
          - name: clarity
            description: "Is the response clear and well-structured?"
            scale: 1-5
          - name: safety
            description: "Is the response free from harmful or inappropriate content?"
            scale: 1-5
        input:
          prompt: "\${ $env.PROMPT }"
          response: "\${ $context.generate_response.text }"
          expected_topics: "\${ $env.EXPECTED_TOPICS }"
        timeout: 120
      export:
        as: "\${ . }"
      flow:
        then: compile_report

    - name: compile_report
      kind: transform
      task_config:
        engine: TRANSFORM_ENGINE_JQ
        expression: >
          {
            model: .model,
            prompt: .prompt,
            response_length: (.response | length),
            validation_passed: .validation.valid,
            scores: .eval,
            overall: (if .eval then (.eval | to_entries | map(.value) | add / length) else null end)
          }
        input: "\${ {model: $env.MODEL_UNDER_TEST, prompt: $env.PROMPT, response: $context.generate_response.text, validation: $context.validate_structure, eval: $context.evaluate_quality} }"
      export:
        as: "\${ . }"
`,
      },
    },

    // -----------------------------------------------------------------------
    // 8. Webhook Event Processor (NEW)
    // Pattern: trigger input + conditional routing + callback
    // -----------------------------------------------------------------------
    {
      id: "webhook-event-processor",
      name: "Webhook Event Processor",
      description:
        "Process incoming webhook events with intelligent routing. An agent analyzes the event payload, a switch routes to different handling paths, and an HTTP callback delivers the result.",
      category: "integration",
      tags: [
        "webhook",
        "event",
        "routing",
        "callback",
        "agent",
        "http",
        "switch",
      ],
      data: {
        yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: webhook-event-processor
spec:
  description: >
    Process incoming webhook events with intelligent routing.
    An agent analyzes the event payload, a switch routes to different
    handling paths based on urgency, and an HTTP callback delivers
    the result. Demonstrates agent_call, switch_case, http_call,
    wait, and set_vars.
  document:
    dsl: "1.0.0"
    namespace: default
    name: webhook-event-processor
    version: "1.0.0"
  env:
    CALLBACK_URL:
      description: "URL to POST the processing result to"
    CALLBACK_SECRET:
      description: "Shared secret for callback authentication"
      is_secret: true
  budget:
    max_cost_micros: 1000000
    max_duration_seconds: 600
  tasks:
    - name: analyze_event
      kind: agent_call
      task_config:
        agent: "org/support-agent"
        message: >
          Analyze this incoming event and determine its urgency and type:

          Event data: \${ $input }

          Classify as: urgent, normal, or low_priority.
          Extract the key action needed.
        output:
          schema:
            type: object
            required:
              - urgency
              - event_type
              - action
            properties:
              urgency:
                type: string
                enum:
                  - urgent
                  - normal
                  - low_priority
              event_type:
                type: string
              action:
                type: string
              summary:
                type: string
          on_invalid: ON_INVALID_RETRY
          max_retries: 1
        config:
          timeout: 120
      export:
        as: "\${ .structured }"
      flow:
        then: route_by_urgency

    - name: route_by_urgency
      kind: switch_case
      task_config:
        cases:
          - name: urgent
            when: "\${ $context.analyze_event.urgency == 'urgent' }"
            then: handle_urgent
          - name: normal
            when: "\${ $context.analyze_event.urgency == 'normal' }"
            then: handle_normal
          - name: default
            then: handle_low_priority

    - name: handle_urgent
      kind: set_vars
      task_config:
        vars:
          processing_result: >
            URGENT: \${ $context.analyze_event.action }
          priority: "P1"
          notify_channel: "incidents"
      export:
        as: "\${ . }"
      flow:
        then: send_callback

    - name: handle_normal
      kind: set_vars
      task_config:
        vars:
          processing_result: "\${ $context.analyze_event.action }"
          priority: "P3"
          notify_channel: "general"
      export:
        as: "\${ . }"
      flow:
        then: cooldown

    - name: handle_low_priority
      kind: set_vars
      task_config:
        vars:
          processing_result: "\${ $context.analyze_event.action }"
          priority: "P5"
          notify_channel: "backlog"
      export:
        as: "\${ . }"
      flow:
        then: cooldown

    - name: cooldown
      kind: wait
      task_config:
        duration:
          seconds: 5
      flow:
        then: send_callback

    - name: send_callback
      kind: http_call
      task_config:
        method: POST
        url: "\${ $env.CALLBACK_URL }"
        headers:
          Content-Type: "application/json"
          X-Webhook-Secret: "\${ $env.CALLBACK_SECRET }"
        body: >
          {
            "event_type": "\${ $context.analyze_event.event_type }",
            "urgency": "\${ $context.analyze_event.urgency }",
            "action": "\${ $context.analyze_event.action }",
            "summary": "\${ $context.analyze_event.summary }"
          }
        timeout: 15
        max_retries: 2
      export:
        as: "\${ . }"
`,
      },
    },
  ];
