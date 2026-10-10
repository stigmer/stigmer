// Plugin evals — a plugin's own evals/ test cases run on Stigmer's engines,
// with and without the plugin, on the models the eval names: the plugin
// page's Evals tab, its data and behavior hooks, the pure view rules, and a
// run made into a test case.

export { PluginEvalsTab, type PluginEvalsTabProps } from "./PluginEvalsTab.js";
export {
  PluginEvalResults,
  type PluginEvalResultsProps,
} from "./PluginEvalResults.js";
export { usePluginEvals, type UsePluginEvalsReturn } from "./usePluginEvals.js";
export {
  usePluginEval,
  PLUGIN_EVAL_POLL_MS,
  type UsePluginEvalReturn,
} from "./usePluginEval.js";
export {
  useStartPluginEval,
  type UseStartPluginEvalReturn,
} from "./useStartPluginEval.js";
export {
  useCancelPluginEval,
  type UseCancelPluginEvalReturn,
} from "./useCancelPluginEval.js";
export {
  DEFAULT_EVAL_FORM,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_COST_USD,
  MAX_EVAL_RUNS,
  MAX_EVAL_TARGETS,
  evalCaseRowsOf,
  compareEvals,
  evalFormProblem,
  evalLabelOf,
  pluginEvalInputOf,
  evalTargetLabelsOf,
  type EvalCaseRow,
  type EvalCaseCell,
  type EvalCompareRow,
  type EvalCompareSide,
  type EvalFormSettings,
  type EvalFormTarget,
  type EvalPluginRef,
  type EvalTryView,
} from "./eval-view.js";
export {
  testCaseOfRun,
  zipTestCase,
  type RunForTestCase,
} from "./test-case.js";
