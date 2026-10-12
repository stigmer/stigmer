// Agent evals — the eval cases of the plugins an agent attaches, run on the
// agent itself and stamped with its version: the agent page's Evals tab,
// its results view, its data and behavior hooks, and the pure view rules.

export { AgentEvalsTab, type AgentEvalsTabProps } from "./AgentEvalsTab.js";
export {
  AgentEvalResults,
  type AgentEvalResultsProps,
} from "./AgentEvalResults.js";
export { useAgentEvals, type UseAgentEvalsReturn } from "./useAgentEvals.js";
export {
  useAgentEval,
  AGENT_EVAL_POLL_MS,
  type UseAgentEvalReturn,
} from "./useAgentEval.js";
export {
  useStartAgentEval,
  type UseStartAgentEvalReturn,
} from "./useStartAgentEval.js";
export {
  useCancelAgentEval,
  type UseCancelAgentEvalReturn,
} from "./useCancelAgentEval.js";
export {
  agentEvalCaseSourceOf,
  agentEvalFormProblem,
  agentEvalInputOf,
  agentEvalLabelOf,
  agentEvalSectionsOf,
  agentEvalVersionOf,
  compareAgentEvals,
  defaultAgentEvalForm,
  type AgentEvalCompareSection,
  type AgentEvalFormSettings,
  type AgentEvalPluginSection,
  type EvalAgentRef,
} from "./agent-eval-view.js";
