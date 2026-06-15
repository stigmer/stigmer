// Public surface of the CLI output module.

export {
  type CommandClass,
  type OutputFlags,
  type OutputFormat,
  resolveFormat,
  supportedFormats,
} from "./format.js";
export {
  protoToJsonValue,
  renderProtoJson,
  renderProtoListJson,
  renderProtoListYaml,
  renderProtoYaml,
} from "./proto.js";
export { renderEmpty, renderTable } from "./table.js";
export {
  CommandResult,
  type KeyValue,
  renderResult,
  type ResultStatus,
  type ResultStreams,
  resultToHuman,
  resultToJson,
  resultToQuiet,
  Section,
} from "./command-result.js";
export { type NdjsonEvent, ndjsonLine, writeNdjson } from "./ndjson.js";
export { shouldColorize, type Styler, styler } from "./style.js";
