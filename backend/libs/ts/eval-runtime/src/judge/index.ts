// The AI judge's entry, `@stigmer/eval-runtime/judge`: its instruction and
// version, rubrics, verdict schema, message, the subject's parts and
// renderer, and the verdict reader, so the server that grades a run, the
// runner that runs the judge and the benchmark that calibrates it hold one
// source. Separate from the package's root because the version hashes with
// `node:crypto`, which a browser bundle of the root must never load. Each
// module's header carries its rules and trade-offs.

export { JUDGE_INSTRUCTIONS, JUDGE_INSTRUCTION_VERSION } from "./instruction.js";
export type { JsonObject, JsonValue } from "./json.js";
export {
  ACTED_ONLY_AS_ASKED,
  ASKED_WHEN_UNCLEAR,
  DID_THE_TASK,
  JUDGE_EVALUATOR_VERSION,
  MADE_NOTHING_UP,
  REASON_MAX_LENGTH,
  RUBRICS,
  VERDICT_SCHEMA,
  judgeMessage,
  type Rubric,
} from "./rubrics.js";
export {
  ALL_VERDICT_RESULTS,
  REASON_CUT_MARKER,
  cutReason,
  readVerdict,
  type RubricVerdict,
  type VerdictReading,
  type VerdictResultName,
  type VerdictShape,
} from "./verdict.js";
export {
  ANSWER_MAX_LENGTH,
  CUT_MARKER,
  EARLIER_TURNS_MAX,
  EARLIER_TURN_FIELD_MAX_LENGTH,
  REQUEST_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
  TOOL_FIELD_MAX_LENGTH,
  renderSubject,
  type SubjectCall,
  type SubjectCallStatus,
  type SubjectParts,
  type SubjectTurn,
} from "./subject.js";
