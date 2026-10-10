/**
 * `readEvalSuite`: a plugin's eval suite, in Claude Code's plugin-eval
 * format, read from the same `PluginFiles` the install reads.
 *
 * Pure and synchronous like `readPluginPackage`, and never a refusal: a
 * suite is the author's tests, not part of what Stigmer installs, so a case
 * that cannot load is a finding and the rest of the suite still reads. The
 * install summarises the result on the plugin; the eval workflow reads the
 * archive again at the digest it runs, so both see one reading.
 *
 * The directory is `evals/`, or a Claude-shaped manifest's
 * `experimental.evals` when that is a relative path of plain directory
 * names; any other value is an `eval-dir-invalid` finding and `evals/` is
 * used, the format's rule for an unusable manifest value. The manifest is
 * found by the library's own detection, so the reader and the install never
 * disagree on which manifest a plugin has, and the rule is `eval-dir.ts`'s,
 * which the skill listing shares to leave the suite out of every skill.
 *
 * A case is a directory under the suite holding `prompt.md` or `case.yaml`;
 * a directory that is neither may group cases beneath it, and everything
 * inside a case belongs to it (its `graders/`, fixtures, its own `mocks/`).
 * `results/` and `mocks/` at the suite root are the runner's output and the
 * suite's MCP mocks, never cases. Every file is read through the
 * `evalDocument` cap.
 *
 * Fields follow the format's precedence: `prompt.md` frontmatter overrides
 * the matching `case.yaml` field (a whole field, a list included, never
 * merged), the `prompt.md` body is the prompt and `execution.prompt` the
 * fallback when that body is blank, and the graders are `case.yaml`'s list
 * then `graders/*.md` in path order. An unknown key in either file is an
 * error for that case, as Claude Code treats it.
 *
 * A case that uses a feature Stigmer does not run yet still loads, with
 * `unsupported` naming the first such feature in `EVAL_UNSUPPORTED_FEATURES`
 * order: running it without the feature would produce a wrong score.
 */

import { isJsonObject, type JsonObject, readCapped } from "../documents.js";
import { detectManifests } from "../detect.js";
import { basename, comparePaths, decodeUtf8, joinPath, PluginFileIndex, type PluginFiles } from "../files.js";
import { extractFrontmatter, parseFrontmatter } from "../frontmatter.js";
import { Findings } from "../messages.js";
import {
  CaseFindings,
  checkSchemaVersion,
  type EvalFindingKind,
  type FieldScope,
  readEnv,
  readInteger,
  readNonEmptyString,
  readString,
  readStringList,
  unknownKeys,
  wrong,
} from "./fields.js";
import { DEFAULT_EVAL_DIR, resolveEvalDir } from "./eval-dir.js";
import { readGrader } from "./graders.js";
import type { EvalCase, EvalCaseContext, EvalGrader, EvalSuite, EvalSuiteFinding } from "./types.js";

export { DEFAULT_EVAL_DIR } from "./eval-dir.js";

/** Graders a case may carry and still run: one Score criterion per grader, and a Score holds 32. */
export const EVAL_MAX_GRADERS = 32;

/**
 * The features Stigmer reads but does not run yet, in the order a case is
 * checked for them; `EvalCase.unsupported` is one of these phrases.
 */
export const EVAL_UNSUPPORTED_FEATURES = [
  "context.scaffold_script",
  "context.add_dirs",
  "context.history_file",
  "env",
  "mock_calls",
  "mocks",
  "more than 32 graders",
] as const;

export type EvalUnsupportedFeature = (typeof EVAL_UNSUPPORTED_FEATURES)[number];

const PROMPT_FILE = "prompt.md";
const CASE_FILE = "case.yaml";

/** The defaults the format documents. */
const DEFAULT_RUNS = 3;
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_SECONDS = 300;

/** Fields a case takes from either file; only those present are set, so a spread overrides by field. */
interface CaseFields {
  readonly name?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly plugins?: readonly string[];
  readonly runs?: number;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly timeoutSeconds?: number;
  readonly allowedTools?: readonly string[];
  readonly appendSystemPrompt?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** `prompt.md` frontmatter keys, the format's table. */
const PROMPT_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "name",
  "description",
  "tags",
  "plugins",
  "runs",
  "expected_outcome",
  "model",
  "max_turns",
  "timeout_seconds",
  "allowed_tools",
  "append_system_prompt",
  "env",
]);

const CASE_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "name",
  "description",
  "tags",
  "plugins",
  "runs",
  "expected_outcome",
  "context",
  "graders",
  "execution",
]);

const EXECUTION_KEYS: ReadonlySet<string> = new Set([
  "model",
  "max_turns",
  "timeout_seconds",
  "allowed_tools",
  "append_system_prompt",
  "env",
  "prompt",
]);

const CONTEXT_KEYS: ReadonlySet<string> = new Set(["scaffold_script", "add_dirs", "history_file"]);

export function readEvalSuite(files: PluginFiles): EvalSuite {
  const index = new PluginFileIndex(files);
  const findings: EvalSuiteFinding[] = [];
  const dir = suiteDir(index, findings);
  const suiteMocks = index.isDirectory(`${dir}/mocks`);

  const cases: EvalCase[] = [];
  const caseByName = new Map<string, string>();
  for (const caseDir of findCaseDirs(index, dir)) {
    const caseFindings = new CaseFindings();
    const evalCase = readCase(index, caseDir, suiteMocks, caseFindings);
    if (evalCase !== undefined) {
      const first = caseByName.get(evalCase.name);
      if (first === undefined) {
        caseByName.set(evalCase.name, caseDir);
        cases.push(evalCase);
      } else {
        caseFindings.add("eval-case-invalid", caseDir, `case name '${evalCase.name}' is already used by '${first}'`);
      }
    }
    findings.push(...caseFindings.list);
  }
  return { dir, cases, findings };
}

function suiteDir(index: PluginFileIndex, findings: EvalSuiteFinding[]): string {
  // The install reports manifest problems; this read only needs the value.
  const { dir, unusable } = resolveEvalDir(detectManifests(index, new Findings()));
  if (unusable !== undefined) {
    findings.push({
      kind: "eval-dir-invalid",
      path: unusable.manifest,
      message:
        `${unusable.manifest}: experimental.evals ${JSON.stringify(unusable.value)} is not a relative path of plain directory names ` +
        `(such as 'qa' or 'quality/evals'); using ${DEFAULT_EVAL_DIR}/`,
    });
  }
  return dir;
}

/** Every case directory under the suite, sorted by path. */
function findCaseDirs(index: PluginFileIndex, root: string): readonly string[] {
  const found: string[] = [];
  const visit = (dir: string, atRoot: boolean): void => {
    for (const child of index.childDirectories(dir)) {
      if (atRoot && (child === "results" || child === "mocks")) continue;
      const path = joinPath(dir, child);
      if (index.has(`${path}/${PROMPT_FILE}`) || index.has(`${path}/${CASE_FILE}`)) found.push(path);
      else visit(path, false);
    }
  };
  visit(root, true);
  return found.sort(comparePaths);
}

/** One document's text through the `evalDocument` cap, or `undefined` after a finding of `kind`. */
function readDocument(index: PluginFileIndex, path: string, kind: EvalFindingKind, findings: CaseFindings): string | undefined {
  const read = readCapped(index, path, "evalDocument");
  if (!read.ok) {
    findings.add(kind, path, `the file is ${read.size} bytes, over the ${read.limit}-byte limit`);
    return undefined;
  }
  return decodeUtf8(read.bytes);
}

/** A YAML mapping, or `undefined` after a finding. */
function parseMapping(yaml: string, scope: FieldScope, what: string): JsonObject | undefined {
  const parsed = parseFrontmatter(yaml);
  if (!parsed.ok) {
    scope.findings.add(scope.invalid, scope.path, `${what} is not valid YAML: ${parsed.detail}`);
    return undefined;
  }
  return parsed.fields;
}

interface MarkdownDocument {
  readonly fields: JsonObject;
  readonly body: string;
}

/**
 * A Markdown file with optional frontmatter: no opening `---` is a body
 * with no fields, an unclosed one is a finding.
 */
function readMarkdown(index: PluginFileIndex, scope: FieldScope): MarkdownDocument | undefined {
  const text = readDocument(index, scope.path, scope.invalid, scope.findings);
  if (text === undefined) return undefined;
  const extracted = extractFrontmatter(text);
  if (!extracted.ok) {
    if (extracted.reason === "unclosed") {
      scope.findings.add(scope.invalid, scope.path, "the frontmatter is not closed (missing the closing '---')");
      return undefined;
    }
    return { fields: {}, body: text };
  }
  const fields = parseMapping(extracted.yaml, scope, "the frontmatter");
  return fields === undefined ? undefined : { fields, body: extracted.body };
}

/** The fields `prompt.md` puts at its top level and `case.yaml` at its own. */
function readTopFields(object: JsonObject, scope: FieldScope): CaseFields {
  const name = readNonEmptyString(object, "name", scope);
  const description = readString(object, "description", scope);
  const tags = readStringList(object, "tags", scope);
  const plugins = readStringList(object, "plugins", scope);
  const runs = readInteger(object, "runs", 1, 50, scope);
  readString(object, "expected_outcome", scope);
  return {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(tags !== undefined && { tags }),
    ...(plugins !== undefined && { plugins }),
    ...(runs !== undefined && { runs }),
  };
}

/** The fields `prompt.md` puts at its top level and `case.yaml` under `execution:`. */
function readExecutionFields(object: JsonObject, scope: FieldScope): CaseFields {
  const model = readNonEmptyString(object, "model", scope);
  const maxTurns = readInteger(object, "max_turns", 1, 200, scope);
  const timeoutSeconds = readInteger(object, "timeout_seconds", 1, 3600, scope);
  const allowedTools = readStringList(object, "allowed_tools", scope);
  const appendSystemPrompt = readString(object, "append_system_prompt", scope);
  const env = readEnv(object, "env", scope);
  return {
    ...(model !== undefined && { model }),
    ...(maxTurns !== undefined && { maxTurns }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(allowedTools !== undefined && { allowedTools }),
    ...(appendSystemPrompt !== undefined && { appendSystemPrompt }),
    ...(env !== undefined && { env }),
  };
}

interface PromptFile {
  readonly fields: CaseFields;
  readonly body: string;
}

function readPromptFile(index: PluginFileIndex, path: string, findings: CaseFindings): PromptFile | undefined {
  const scope: FieldScope = { path, label: "", invalid: "eval-case-invalid", findings };
  const document = readMarkdown(index, scope);
  if (document === undefined) return undefined;
  const { fields } = document;
  unknownKeys(fields, PROMPT_KEYS, scope, "eval-field-unknown", "frontmatter key");
  if (fields["schema_version"] !== undefined) checkSchemaVersion(fields["schema_version"], scope);
  return { fields: { ...readTopFields(fields, scope), ...readExecutionFields(fields, scope) }, body: document.body };
}

interface CaseFile {
  readonly fields: CaseFields;
  readonly prompt?: string;
  readonly context: EvalCaseContext;
  readonly graders: readonly EvalGrader[];
  /** Entries under `graders:`, loaded or not. */
  readonly graderCount: number;
}

function readCaseFile(index: PluginFileIndex, caseDir: string, caseFiles: ReadonlySet<string>, findings: CaseFindings): CaseFile | undefined {
  const path = `${caseDir}/${CASE_FILE}`;
  const scope: FieldScope = { path, label: "", invalid: "eval-case-invalid", findings };
  const text = readDocument(index, path, "eval-case-invalid", findings);
  if (text === undefined) return undefined;
  const object = parseMapping(text, scope, "the file");
  if (object === undefined) return undefined;
  unknownKeys(object, CASE_KEYS, scope, "eval-field-unknown", "key");

  if (object["schema_version"] === undefined) {
    findings.add("eval-case-invalid", path, `schema_version is required ("1.1")`);
  } else {
    checkSchemaVersion(object["schema_version"], scope);
  }
  if (object["name"] === undefined) findings.add("eval-case-invalid", path, "name is required");
  const top = readTopFields(object, scope);

  let execution: CaseFields = {};
  let prompt: string | undefined;
  const executionValue = object["execution"];
  if (executionValue !== undefined) {
    if (!isJsonObject(executionValue)) {
      wrong(scope, "execution", "a mapping");
    } else {
      const executionScope: FieldScope = { ...scope, label: "execution." };
      unknownKeys(executionValue, EXECUTION_KEYS, executionScope, "eval-field-unknown", "key");
      execution = readExecutionFields(executionValue, executionScope);
      prompt = readString(executionValue, "prompt", executionScope);
    }
  }

  const context = readContext(object["context"], scope);

  const graders: EvalGrader[] = [];
  let graderCount = 0;
  const gradersValue = object["graders"];
  if (gradersValue !== undefined) {
    if (!Array.isArray(gradersValue)) {
      scope.findings.add("eval-grader-invalid", path, "graders must be a list");
    } else {
      graderCount = gradersValue.length;
      gradersValue.forEach((entry: unknown, i: number) => {
        const entryScope: FieldScope = { path, label: `graders[${i}].`, invalid: "eval-grader-invalid", findings };
        if (!isJsonObject(entry)) {
          wrong({ ...entryScope, label: "" }, `graders[${i}]`, "a mapping");
          return;
        }
        const name = readNonEmptyString(entry, "name", entryScope);
        if (name === undefined) {
          if (entry["name"] === undefined) findings.add("eval-grader-invalid", path, `graders[${i}].name is required`);
          return;
        }
        const fields = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "name"));
        const grader = readGrader({ name, path, fields, caseDir, caseFiles }, entryScope, "key");
        if (grader !== undefined) graders.push(grader);
      });
    }
  }

  return {
    fields: { ...top, ...execution },
    ...(prompt !== undefined && { prompt }),
    context,
    graders,
    graderCount,
  };
}

function readContext(value: unknown, scope: FieldScope): EvalCaseContext {
  if (value === undefined) return { addDirs: [] };
  if (!isJsonObject(value)) {
    wrong(scope, "context", "a mapping");
    return { addDirs: [] };
  }
  const contextScope: FieldScope = { ...scope, label: "context." };
  unknownKeys(value, CONTEXT_KEYS, contextScope, "eval-field-unknown", "key");
  const scaffoldScript = readNonEmptyString(value, "scaffold_script", contextScope);
  const historyFile = readNonEmptyString(value, "history_file", contextScope);
  const addDirs = readStringList(value, "add_dirs", contextScope) ?? [];
  return {
    ...(scaffoldScript !== undefined && { scaffoldScript }),
    ...(historyFile !== undefined && { historyFile }),
    addDirs,
  };
}

/** `graders/*.md`, in path order. */
function readGraderFiles(
  index: PluginFileIndex,
  caseDir: string,
  caseFiles: ReadonlySet<string>,
  findings: CaseFindings,
): { readonly graders: readonly EvalGrader[]; readonly count: number } {
  const dir = `${caseDir}/graders`;
  const names = index.childFiles(dir).filter((file) => file.endsWith(".md"));
  const graders: EvalGrader[] = [];
  for (const file of names) {
    const path = `${dir}/${file}`;
    const scope: FieldScope = { path, label: "", invalid: "eval-grader-invalid", findings };
    const document = readMarkdown(index, scope);
    if (document === undefined) continue;
    const grader = readGrader(
      { name: file.slice(0, -".md".length), path, fields: document.fields, body: document.body, caseDir, caseFiles },
      scope,
      "frontmatter key",
    );
    if (grader !== undefined) graders.push(grader);
  }
  return { graders, count: names.length };
}

function readCase(index: PluginFileIndex, caseDir: string, suiteMocks: boolean, findings: CaseFindings): EvalCase | undefined {
  const files = index.filesUnder(caseDir);
  const caseFiles = new Set(files);
  const promptPath = `${caseDir}/${PROMPT_FILE}`;
  const casePath = `${caseDir}/${CASE_FILE}`;
  const promptFile = index.has(promptPath) ? readPromptFile(index, promptPath, findings) : undefined;
  const caseFile = index.has(casePath) ? readCaseFile(index, caseDir, caseFiles, findings) : undefined;
  const graderFiles = readGraderFiles(index, caseDir, caseFiles, findings);

  const graders = [...(caseFile?.graders ?? []), ...graderFiles.graders];
  if ((caseFile?.graderCount ?? 0) + graderFiles.count === 0) {
    findings.add("eval-case-invalid", caseDir, "graders is required: add a graders/<name>.md file or a 'graders' entry in case.yaml");
  }
  const seen = new Set<string>();
  for (const grader of graders) {
    if (seen.has(grader.name)) {
      findings.add("eval-grader-invalid", grader.path, `grader name '${grader.name}' is used by another grader of this case`);
    }
    seen.add(grader.name);
  }

  // A file that could not be read already said so; its prompt is unknown, not missing.
  const unread = (index.has(promptPath) && promptFile === undefined) || (index.has(casePath) && caseFile === undefined);
  const body = promptFile?.body;
  const prompt = body !== undefined && body.trim() !== "" ? body : caseFile?.prompt;
  if (!unread && (prompt === undefined || prompt.trim() === "")) {
    findings.add(
      "eval-case-invalid",
      promptFile !== undefined ? promptPath : casePath,
      "the prompt is required: write it as prompt.md's body or as case.yaml's execution.prompt",
    );
  }

  if (!findings.empty || prompt === undefined) return undefined;

  const fields: CaseFields = { ...caseFile?.fields, ...promptFile?.fields };
  const context = caseFile?.context ?? { addDirs: [] };
  const env = fields.env ?? {};
  const mocks = suiteMocks || index.isDirectory(`${caseDir}/mocks`);
  const unsupported = unsupportedOf(context, env, graders, mocks);
  return {
    name: fields.name ?? basename(caseDir),
    dir: caseDir,
    ...(fields.description !== undefined && { description: fields.description }),
    tags: fields.tags ?? [],
    prompt,
    runs: fields.runs ?? DEFAULT_RUNS,
    ...(fields.model !== undefined && { model: fields.model }),
    maxTurns: fields.maxTurns ?? DEFAULT_MAX_TURNS,
    timeoutSeconds: fields.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    allowedTools: fields.allowedTools ?? [],
    ...(fields.appendSystemPrompt !== undefined && { appendSystemPrompt: fields.appendSystemPrompt }),
    env,
    plugins: fields.plugins ?? [],
    context,
    files,
    graders,
    ...(unsupported !== undefined && { unsupported }),
  };
}

function usesMockCalls(grader: EvalGrader): boolean {
  const { check } = grader;
  switch (check.type) {
    case "regex":
      return check.target.kind === "mock_calls";
    case "llm":
      return check.focus.kind === "mock_calls";
    case "tool_used":
    case "tool_order":
    case "file_exists":
    case "baseline":
      return false;
    /* v8 ignore start -- @preserve: the never arm; readGrader builds only these check types, so no grader reaches it */
    default: {
      const exhaustive: never = check;
      throw new Error(`unknown grader ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

function unsupportedOf(
  context: EvalCaseContext,
  env: Readonly<Record<string, string>>,
  graders: readonly EvalGrader[],
  mocks: boolean,
): EvalUnsupportedFeature | undefined {
  if (context.scaffoldScript !== undefined) return "context.scaffold_script";
  if (context.addDirs.length > 0) return "context.add_dirs";
  if (context.historyFile !== undefined) return "context.history_file";
  if (Object.keys(env).length > 0) return "env";
  if (graders.some(usesMockCalls)) return "mock_calls";
  if (mocks) return "mocks";
  if (graders.length > EVAL_MAX_GRADERS) return "more than 32 graders";
  return undefined;
}
