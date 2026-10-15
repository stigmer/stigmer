// ScoringRules — AI grading switched on for one agent: whether it runs, how
// many runs it samples, its monthly spending limit and its judge model.

export {
  useAgentScoringRule,
  type UseAgentScoringRuleReturn,
} from "./useAgentScoringRule.js";
export {
  useSaveScoringRule,
  type UseSaveScoringRuleReturn,
} from "./useSaveScoringRule.js";
export {
  DEFAULT_GRADING_SETTINGS,
  MAX_ONE_IN,
  type GradingSettings,
} from "./grading-settings.js";
