/**
 * Evaluator domain constants: the refusal copy its chains answer with. The
 * copy is wire contract: the console and the CLI show it as given, and the
 * conformance suite pins it.
 */

/** The refusal reason a client keys on to switch from create to update. */
export const SCORING_RULE_EXISTS_REASON = "EVALUATOR_EXISTS";

/** The create lane's deny copy when the caller cannot edit the agent. */
export const SCORING_RULE_CREATE_DENIED_MESSAGE =
  "unauthorized to configure grading for agent";

/** The refusal of a second evaluator for one agent. */
export function scoringRuleExistsMessage(evaluatorId: string): string {
  return `this agent already has an evaluator (evaluator ${evaluatorId}); update that evaluator instead`;
}

/** The refusal of an organization that is not the agent's. */
export function scoringRuleOrgMismatchMessage(agentOrg: string): string {
  return `metadata.org must be the agent's organization (${agentOrg})`;
}

/** The refusal of an update that moves an evaluator to another agent. */
export const SCORING_RULE_AGENT_IMMUTABLE_MESSAGE =
  "spec.agent_id of an evaluator cannot change; delete it and create one for the other agent";

/** The answer of getByAgent for an agent with grading off. */
export function noScoringRuleMessage(agentId: string): string {
  return `agent ${agentId} has no evaluator: AI grading is off`;
}
