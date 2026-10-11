// The package entry: re-exports what a plugin eval's server and runner both
// execute with (the transcript reader, the expect guard, mock rendering and
// the try-stop wording), so neither reaches into a file path. Each module's
// header carries its rules and trade-offs.

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
