import type { InsertionContext } from "./insertion-context.js";

/**
 * A suggested task kind with a human-readable reason.
 *
 * Rendered in the "Suggested" section of the picker, above Recent and
 * All Categories. Suggestions are derived from static domain knowledge
 * about common workflow patterns.
 */
export interface TaskKindSuggestion {
  readonly kind: string;
  readonly reason: string;
}

/**
 * Static compatibility map: source task kind -> suggested next kinds.
 *
 * Derived from the research report (Section 4.2) and common workflow
 * authoring patterns observed across n8n, Retool, and Step Functions.
 *
 * The map encodes domain knowledge: "after an HTTP call, users commonly
 * validate the response, transform the data, or branch on status."
 */
const SUGGESTIONS_AFTER_KIND: ReadonlyMap<string, readonly TaskKindSuggestion[]> = new Map([
  [
    "http_call",
    [
      { kind: "validate", reason: "Validate HTTP response" },
      { kind: "transform", reason: "Transform response data" },
      { kind: "switch_case", reason: "Branch on status/content" },
    ],
  ],
  [
    "grpc_call",
    [
      { kind: "validate", reason: "Validate gRPC response" },
      { kind: "transform", reason: "Transform response data" },
      { kind: "switch_case", reason: "Branch on result" },
    ],
  ],
  [
    "llm_call",
    [
      { kind: "eval", reason: "Evaluate LLM output quality" },
      { kind: "switch_case", reason: "Branch on structured output" },
      { kind: "set_vars", reason: "Store output in variables" },
      { kind: "transform", reason: "Extract from response" },
    ],
  ],
  [
    "agent_call",
    [
      { kind: "switch_case", reason: "Branch on agent result" },
      { kind: "human_input", reason: "Review agent output" },
      { kind: "transform", reason: "Extract structured data" },
      { kind: "eval", reason: "Evaluate agent quality" },
    ],
  ],
  [
    "transform",
    [
      { kind: "switch_case", reason: "Branch on transformed value" },
      { kind: "http_call", reason: "Send transformed data" },
      { kind: "agent_call", reason: "Process with agent" },
      { kind: "validate", reason: "Validate transformation" },
    ],
  ],
  [
    "set_vars",
    [
      { kind: "switch_case", reason: "Branch on variable value" },
      { kind: "http_call", reason: "Use variables in request" },
      { kind: "agent_call", reason: "Pass variables to agent" },
    ],
  ],
  [
    "validate",
    [
      { kind: "switch_case", reason: "Branch on validation result" },
      { kind: "transform", reason: "Fix validation issues" },
      { kind: "raise_error", reason: "Fail on invalid data" },
    ],
  ],
  [
    "human_input",
    [
      { kind: "switch_case", reason: "Branch on approval decision" },
      { kind: "agent_call", reason: "Continue with agent" },
      { kind: "http_call", reason: "Proceed with API call" },
      { kind: "notification", reason: "Notify about decision" },
    ],
  ],
  [
    "eval",
    [
      { kind: "switch_case", reason: "Branch on evaluation score" },
      { kind: "human_input", reason: "Review if score is low" },
      { kind: "notification", reason: "Alert on quality issue" },
    ],
  ],
  [
    "switch_case",
    [
      { kind: "agent_call", reason: "Process in branch" },
      { kind: "http_call", reason: "Call API in branch" },
      { kind: "llm_call", reason: "Generate in branch" },
    ],
  ],
  [
    "fork",
    [
      { kind: "transform", reason: "Merge parallel results" },
      { kind: "switch_case", reason: "Branch on merged result" },
      { kind: "agent_call", reason: "Process merged output" },
    ],
  ],
  [
    "for_each",
    [
      { kind: "transform", reason: "Aggregate iteration results" },
      { kind: "switch_case", reason: "Branch on aggregated result" },
    ],
  ],
  [
    "listen",
    [
      { kind: "switch_case", reason: "Branch on event type" },
      { kind: "agent_call", reason: "Process received event" },
      { kind: "transform", reason: "Extract event data" },
    ],
  ],
  [
    "wait",
    [
      { kind: "http_call", reason: "Poll after delay" },
      { kind: "agent_call", reason: "Resume processing" },
      { kind: "notification", reason: "Notify after wait" },
    ],
  ],
  [
    "notification",
    [
      { kind: "wait", reason: "Wait for response" },
      { kind: "listen", reason: "Wait for event" },
      { kind: "human_input", reason: "Await acknowledgment" },
    ],
  ],
]);

/**
 * Context-specific suggestions for branch addition modes.
 */
const SUGGESTIONS_FOR_BRANCH: ReadonlyMap<string, readonly TaskKindSuggestion[]> = new Map([
  [
    "add-switch-case",
    [
      { kind: "agent_call", reason: "Process this case with agent" },
      { kind: "http_call", reason: "Call API for this case" },
      { kind: "human_input", reason: "Require approval for this case" },
      { kind: "llm_call", reason: "Generate for this case" },
    ],
  ],
  [
    "add-fork-branch",
    [
      { kind: "agent_call", reason: "Run agent in parallel" },
      { kind: "http_call", reason: "Call API in parallel" },
      { kind: "llm_call", reason: "Generate in parallel" },
      { kind: "transform", reason: "Transform in parallel" },
    ],
  ],
  [
    "add-catch-handler",
    [
      { kind: "notification", reason: "Notify on error" },
      { kind: "agent_call", reason: "Attempt recovery with agent" },
      { kind: "raise_error", reason: "Re-raise with context" },
      { kind: "http_call", reason: "Report error to service" },
    ],
  ],
]);

/** Default suggestions when no specific context is available. */
const DEFAULT_SUGGESTIONS: readonly TaskKindSuggestion[] = [
  { kind: "agent_call", reason: "Most common task type" },
  { kind: "llm_call", reason: "Direct LLM invocation" },
  { kind: "http_call", reason: "External API call" },
  { kind: "switch_case", reason: "Conditional branching" },
];

/**
 * Returns suggested task kinds for the given insertion context.
 *
 * The suggestions are based on a static compatibility map that encodes
 * common workflow authoring patterns. Results are ordered by relevance
 * (most common pairing first) and capped at `maxResults`.
 */
export function getSuggestedKinds(
  context: InsertionContext,
  maxResults = 5,
): readonly TaskKindSuggestion[] {
  // Branch-specific modes have their own suggestion sets
  const branchSuggestions = SUGGESTIONS_FOR_BRANCH.get(context.mode);
  if (branchSuggestions) {
    return branchSuggestions.slice(0, maxResults);
  }

  // For edge-splice and append-after, look up by source kind
  if (context.sourceKind) {
    const kindSuggestions = SUGGESTIONS_AFTER_KIND.get(context.sourceKind);
    if (kindSuggestions && kindSuggestions.length > 0) {
      return kindSuggestions.slice(0, maxResults);
    }
  }

  return DEFAULT_SUGGESTIONS.slice(0, maxResults);
}
