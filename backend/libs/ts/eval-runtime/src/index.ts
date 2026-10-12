// The package entry: re-exports what a plugin eval's server and runner both
// execute with (the transcript reader, the expect guard, mock rendering and
// the try-stop wording) and the AI judge's rule set (its instruction,
// rubrics, verdict schema, message and verdict reader), so neither reaches
// into a file path. Each module's header carries its rules and trade-offs.

export {
  parseTranscript,
  renderTranscript,
  type TranscriptBlock,
  type TranscriptMessage,
  type TranscriptParse,
  type TranscriptParseOptions,
} from "./transcript.js";
export {
  EXPECT_MAX_PATTERN_LENGTH,
  EXPECT_MAX_UNITS,
  checkExpect,
  compileExpect,
  compilePattern,
  matchPattern,
  type CompiledExpect,
  type CompiledPattern,
  type ExpectCompile,
} from "./expect.js";
export {
  fixturePath,
  mockBodyOf,
  parseToolsList,
  renderMockAnswer,
  type MockRender,
  type SavedTool,
} from "./mock.js";
export { COST_LIMIT_ERROR_PREFIX, formatTryStop, parseTryStop, type TryStop } from "./try-stop.js";
export { JUDGE_INSTRUCTIONS, JUDGE_INSTRUCTION_VERSION } from "./judge/instruction.js";
export type { JsonObject, JsonValue } from "./judge/json.js";
export {
  DID_THE_TASK,
  JUDGE_EVALUATOR_VERSION,
  MADE_NOTHING_UP,
  REASON_MAX_LENGTH,
  RUBRICS,
  VERDICT_SCHEMA,
  judgeMessage,
  type Rubric,
} from "./judge/rubrics.js";
export {
  ALL_VERDICT_RESULTS,
  REASON_CUT_MARKER,
  cutReason,
  readVerdict,
  type RubricVerdict,
  type VerdictReading,
  type VerdictResultName,
  type VerdictShape,
} from "./judge/verdict.js";
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
} from "./judge/subject.js";
