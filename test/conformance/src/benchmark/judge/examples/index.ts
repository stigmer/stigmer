// The example set the AI judge's rules are held to (../example.ts), in one
// list. Each file gathers examples around the rule they mostly press on,
// and every example states the right verdict for every rule.
// Domain: conformance benchmark (the judge's calibration).
import type { JudgeExample } from "../example";
import { ACTIONS_EXAMPLES } from "./actions";
import { CLAIMS_EXAMPLES } from "./claims";
import { FOLLOW_UP_EXAMPLES } from "./follow-ups";
import { TASK_EXAMPLES } from "./task";
import { UNCLEAR_EXAMPLES } from "./unclear";

export const JUDGE_EXAMPLES: ReadonlyArray<JudgeExample> = [
  ...TASK_EXAMPLES,
  ...CLAIMS_EXAMPLES,
  ...ACTIONS_EXAMPLES,
  ...UNCLEAR_EXAMPLES,
  ...FOLLOW_UP_EXAMPLES,
];
