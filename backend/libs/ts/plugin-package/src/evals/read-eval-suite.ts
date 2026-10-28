/**
 * `readEvalSuite`: a plugin's eval suite, in Claude Code's plugin-eval
 * format, read from the same `PluginFiles` the install reads; and
 * `readEvalFolder`: a pushed eval, the same format with the archive's root
 * as the suite's directory. Both read cases one way; they differ in where
 * the suite is and which servers its mocks may stand in for (the end of
 * this comment).
 *
 * Pure and synchronous like `readPluginPackage`, and never a refusal: a
 * suite is the author's tests, not part of what Stigmer installs, so a case
 * that cannot load is a finding and the rest of the suite still reads. The
 * install summarises the result on the plugin; the eval workflow reads the
 * archive again at the digest it runs, so both see one reading.
 *
 * The directory is `evals/`, or a Claude-shaped manifest's
 * `experimental.evals` when that is a relative path of plain directory
 * names clear of the plugin's skills (with or without a `./` prefix, or an
 * array's first entry); any other value is an
 * `eval-dir-invalid` finding and `evals/` is used, the format's rule for an
 * unusable manifest value. Skills a manifest declares in `evals/` leave the
 * plugin no suite: an `eval-dir-invalid` finding and no case, since the
 * skills keep their files. The manifest is found by the library's own
 * detection, so the reader and the install never disagree on which manifest
 * a plugin has, and the rule is `eval-dir.ts`'s, which the skill listing
 * shares to leave the suite out of every skill.
 *
 * A case is a directory under the suite holding `prompt.md` or `case.yaml`;
 * a directory that is neither may group cases beneath it, and everything
 * inside a case belongs to it (its `graders/`, fixtures, its own `mocks/`).
 * `results/` and `mocks/` at the suite root are the runner's output and the
 * suite's MCP mocks, never cases. Every file is read through the
 * `evalDocument` cap. A case's mocks are its own `mocks/` over the suite's,
 * file by file (`mocks.ts`).
 *
 * The search goes at most {@link EVAL_MAX_CASE_DEPTH} directories below the
 * suite, and a deeper directory is a finding rather than a recursion that
 * runs out of stack: the install accepts any depth its archive holds. A
 * case's name is at most {@link EVAL_MAX_CASE_NAME} characters and its
 * directory's path at most {@link EVAL_MAX_CASE_DIR} characters, else the
 * case is invalid: both are matched against an eval's `case_glob` on the
 * server's request path, and both are stored on the plugin and every eval.
 *
 * Fields follow the format's precedence: `prompt.md` frontmatter overrides
 * the matching `case.yaml` field (a whole field, a list included, never
 * merged), the `prompt.md` body is the prompt and `execution.prompt` the
 * fallback when that body is blank, and the graders are `case.yaml`'s list
 * then `graders/*.md` in path order. An unknown key in either file is an
 * error for that case, as Claude Code treats it.
 *
 * A case's `context` paths are checked against its files, as a baseline
 * grader's file is: the scaffold script a file, each of `add_dirs` a
 * directory, the history a `.jsonl` file whose conversation can be resumed
 * (`@stigmer/eval-runtime`'s transcript reader, tool calls and results
 * paired). A path that climbs out of the case or names nothing there stops
 * the case.
 *
 * A case that uses a feature Stigmer does not run yet still loads, with
 * `unsupported` naming the first such feature in `EVAL_UNSUPPORTED_FEATURES`
 * order: running it without the feature would produce a wrong score. A
 * feature one engine cannot run is that engine's alone
 * ({@link evalCaseUnsupportedOn}): the server lists the case as not
 * run on that engine's targets and runs it on the others.
 *
 * A plugin's suite may mock only the servers its plugin declares, the
 * suite's `servers`. A pushed folder names no plugin, so it keeps every
 * mock directory whose name could be an MCP server's
 * (`isToolNameSegment`), and its `servers` are those directories' names:
 * which agent server each stands in for is decided when the eval runs on
 * an agent, not here. A manifest in the folder is a file like any other,
 * and a case naming `plugins` is unsupported: the agent's plugins load,
 * never a folder.
 */

import { isJsonObject, type JsonObject } from "../documents.js";
import { detectManifests } from "../detect.js";
import { basename, comparePaths, decodeUtf8, joinPath, PluginFileIndex, type PluginFiles } from "../files.js";
import { Findings } from "../messages.js";
import {
  CaseFindings,
  checkSchemaVersion,
  type EvalFindingKind,
  type FieldScope,
  readEnv,
  readInteger,
  quote,
  quoteJson,
  readNonEmptyString,
  readString,
  readStringList,
  unknownKeys,
  wrong,
} from "./fields.js";
import { DEFAULT_EVAL_DIR, type EvalDirResolution, resolveEvalDir } from "./eval-dir.js";
import { readGrader } from "./graders.js";
import { type MockServerRule, readCaseMocks } from "./mocks.js";
import { isToolNameSegment } from "../tool-names.js";
import { normaliseMcpServers } from "../normalise/mcp-servers.js";
import { parseTranscript } from "@stigmer/eval-runtime";
import { parseMapping, readDocument, readMarkdown } from "./markdown.js";
import type { EvalCase, EvalCaseContext, EvalGrader, EvalSuite, EvalSuiteFinding } from "./types.js";

export { DEFAULT_EVAL_DIR } from "./eval-dir.js";

/** Graders a case may carry and still run: one Score criterion per grader, and a Score holds 32. */
export const EVAL_MAX_GRADERS = 32;

/** The most directories a case may sit below the suite's directory. */
export const EVAL_MAX_CASE_DEPTH = 32;

/** The longest case name, in characters (code points). */
export const EVAL_MAX_CASE_NAME = 200;

/** The longest plugin-relative path of a case's directory, in characters (code points). */
export const EVAL_MAX_CASE_DIR = 1024;

/** The longest `append_system_prompt` a case may carry, in characters: the most a run takes (`RunSpec.append_system_prompt`). */
export const EVAL_MAX_APPEND_SYSTEM_PROMPT = 32_768;

/**
 * The features Stigmer reads but does not run yet, in the order a case is
 * checked for them; `EvalCase.unsupported` is one of these phrases.
 */
export const EVAL_UNSUPPORTED_FEATURES = ["plugins", "more than 32 graders"] as const;

export type EvalUnsupportedFeature = (typeof EVAL_UNSUPPORTED_FEATURES)[number];

/** An engine a case may run on, by the word the model catalog files its rows under. */
export type EvalEngine = "stigmer" | "claude";

/** A feature some engine cannot run: a recorded conversation to resume. */
export type EvalEngineUnsupportedFeature = "resumed conversations";

/**
 * The features each engine cannot run, in the order a case is checked for
 * them. The native engine runs every one. The Claude engine's conversation
 * lives in its own transcript, which no recorded history seeds yet; its
 * shell is the runner's, so `env` reaches it as on native.
 */
export const EVAL_ENGINE_UNSUPPORTED_FEATURES: Readonly<Record<EvalEngine, readonly EvalEngineUnsupportedFeature[]>> = {
  stigmer: [],
  claude: ["resumed conversations"],
};

/** Whether `evalCase` uses `feature`. */
const USES: Readonly<Record<EvalEngineUnsupportedFeature, (evalCase: EvalCase) => boolean>> = {
  "resumed conversations": (evalCase) => evalCase.context.historyFile !== undefined,
};

/** The first feature of `evalCase` that `engine` cannot run, or `undefined`. */
export function evalCaseUnsupportedOn(engine: EvalEngine, evalCase: EvalCase): EvalEngineUnsupportedFeature | undefined {
  return EVAL_ENGINE_UNSUPPORTED_FEATURES[engine].find((feature) => USES[feature](evalCase));
}

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
  // The install reports manifest and server problems; this read only needs the values.
  const set = detectManifests(index, new Findings());
  const declared = new Set(
    set === undefined ? [] : normaliseMcpServers(index, set.mcpSources, new Findings()).servers.map((server) => server.name),
  );
  const servers = [...declared].sort(comparePaths);
  const { dir, held } = suiteDir(set, findings);
  if (held) return { dir, cases: [], findings, servers };
  const rule: MockServerRule = (server) =>
    declared.has(server) ? undefined : `the plugin declares no MCP server ${quote(server)}, so these mocks are ignored`;
  const cases = readCases({ index, dir, rule, findings, reportedMocks: new Set(), mocked: new Set(), loadsPlugins: true });
  return { dir, cases, findings, servers };
}

/**
 * A pushed eval: the folder at the archive's root, read as a suite whose
 * mocks may stand in for any server a name could be (the module comment).
 * `dir` is the empty string, the root.
 */
export function readEvalFolder(files: PluginFiles): EvalSuite {
  const index = new PluginFileIndex(files);
  const findings: EvalSuiteFinding[] = [];
  const rule: MockServerRule = (server) =>
    isToolNameSegment(server)
      ? undefined
      : `${quote(server)} cannot name an MCP server (letters, digits, '-' and '_', with no '__' and no trailing '_'), so these mocks are ignored`;
  const suite: SuiteContext = { index, dir: "", rule, findings, reportedMocks: new Set(), mocked: new Set(), loadsPlugins: false };
  const cases = readCases(suite);
  return { dir: "", cases, findings, servers: [...suite.mocked].sort(comparePaths) };
}

/** Every case of the suite, in directory order, its findings added to the suite's. */
function readCases(suite: SuiteContext): readonly EvalCase[] {
  const { index, dir, findings } = suite;
  const cases: EvalCase[] = [];
  const caseByName = new Map<string, string>();
  for (const caseDir of findCaseDirs(index, dir, findings)) {
    const caseFindings = new CaseFindings();
    const evalCase = readCase(suite, caseDir, caseFindings);
    if (evalCase !== undefined) {
      const first = caseByName.get(evalCase.name);
      if (first === undefined) {
        caseByName.set(evalCase.name, caseDir);
        cases.push(evalCase);
      } else {
        caseFindings.add("eval-case-invalid", caseDir, `case name ${quote(evalCase.name)} is already used by ${quote(first)}`);
      }
    }
    findings.push(...caseFindings.list);
  }
  return cases;
}

/** What every case of one suite is read against. */
interface SuiteContext {
  readonly index: PluginFileIndex;
  /** The suite's directory; the empty string for a folder at the root. */
  readonly dir: string;
  /** Which servers the suite's mocks may stand in for. */
  readonly rule: MockServerRule;
  /** The suite's findings, where an ignored mock directory is reported. */
  readonly findings: EvalSuiteFinding[];
  /** Mock directories already reported as ignored. */
  readonly reportedMocks: Set<string>;
  /** The servers some case's mocks stand in for, the rule's kept ones. */
  readonly mocked: Set<string>;
  /**
   * Whether a case's `plugins` may name the suite's own plugin: a plugin's
   * suite runs with its plugin, so naming it is no feature Stigmer lacks.
   * A pushed folder runs on an agent with the agent's plugins and loads no
   * folder as a plugin, so any `plugins` entry is unsupported there.
   */
  readonly loadsPlugins: boolean;
}

/** The suite's directory, and whether declared skills hold it, so no case is read; findings for both. */
function suiteDir(
  set: ReturnType<typeof detectManifests>,
  findings: EvalSuiteFinding[],
): { readonly dir: string; readonly held: boolean } {
  const { dir, unusable, heldBySkills } = resolveEvalDir(set);
  const fallback = heldBySkills === undefined ? `using ${DEFAULT_EVAL_DIR}/` : `${DEFAULT_EVAL_DIR}/ is not usable either`;
  if (unusable !== undefined) {
    findings.push({ kind: "eval-dir-invalid", path: unusable.manifest, message: evalDirMessage(unusable, fallback) });
  }
  if (heldBySkills !== undefined) {
    const problem =
      `the skills path ${quote(`./${heldBySkills.path}`)} lies in ${DEFAULT_EVAL_DIR}/, the suite's default directory, so no suite is read; ` +
      "move the skills or name another directory in experimental.evals";
    findings.push({ kind: "eval-dir-invalid", path: heldBySkills.manifest, message: `${heldBySkills.manifest}: ${problem}` });
  }
  return { dir, held: heldBySkills !== undefined };
}

function evalDirMessage(unusable: NonNullable<EvalDirResolution["unusable"]>, fallback: string): string {
  const named = `${unusable.manifest}: experimental.evals ${quoteJson(unusable.value)}`;
  switch (unusable.reason) {
    case "not-a-plain-path":
      return `${named} is not a relative path of plain directory names (such as 'qa' or 'quality/evals'); ${fallback}`;
    case "overlaps-skills":
      return `${named} overlaps the plugin's skills; ${fallback}`;
    /* v8 ignore start -- @preserve: the never arm; resolveEvalDir gives only these reasons */
    default: {
      const exhaustive: never = unusable.reason;
      throw new Error(`unknown eval-dir reason ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/**
 * Every case directory under the suite, sorted by path, at most
 * {@link EVAL_MAX_CASE_DEPTH} levels down; a directory at that depth that
 * is no case and still holds directories is a finding, and its contents
 * are not searched.
 */
function findCaseDirs(index: PluginFileIndex, root: string, findings: EvalSuiteFinding[]): readonly string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number): void => {
    for (const child of index.childDirectories(dir)) {
      if (depth === 0 && (child === "results" || child === "mocks")) continue;
      const path = joinPath(dir, child);
      if (index.has(`${path}/${PROMPT_FILE}`) || index.has(`${path}/${CASE_FILE}`)) found.push(path);
      else if (depth + 1 < EVAL_MAX_CASE_DEPTH) visit(path, depth + 1);
      else if (index.childDirectories(path).length > 0) {
        findings.push({
          kind: "eval-case-invalid",
          path,
          message: `${path}: the directory is nested too deep (cases sit at most ${EVAL_MAX_CASE_DEPTH} directories below ${root === "" ? "the folder's root" : `${root}/`}), so nothing beneath it is read`,
        });
      }
    }
  };
  visit(root, 0);
  return found.sort(comparePaths);
}

/** Whether `text` has more than `max` characters (code points), reading no further than it must. */
function longerThan(text: string, max: number): boolean {
  if (text.length <= max) return false;
  let characters = 0;
  for (const _ of text) {
    if (++characters > max) return true;
  }
  return false;
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
  const appendSystemPrompt = readAppendSystemPrompt(object, scope);
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

/**
 * A case's `append_system_prompt`, refused when longer than a run takes: a
 * case loaded with it would fail every try at the run's create. Counted in
 * characters (code points), as the run's limit is.
 */
function readAppendSystemPrompt(object: JsonObject, scope: FieldScope): string | undefined {
  const value = readString(object, "append_system_prompt", scope);
  if (value === undefined || !longerThan(value, EVAL_MAX_APPEND_SYSTEM_PROMPT)) return value;
  return wrong(scope, "append_system_prompt", `at most ${EVAL_MAX_APPEND_SYSTEM_PROMPT} characters`);
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

function readCase(suite: SuiteContext, caseDir: string, findings: CaseFindings): EvalCase | undefined {
  const { index } = suite;
  if (longerThan(caseDir, EVAL_MAX_CASE_DIR)) {
    findings.add("eval-case-invalid", caseDir, `the case directory's path is over ${EVAL_MAX_CASE_DIR} characters`);
    return undefined;
  }
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
      findings.add("eval-grader-invalid", grader.path, `grader name ${quote(grader.name)} is used by another grader of this case`);
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

  const fields: CaseFields = { ...caseFile?.fields, ...promptFile?.fields };
  const name = fields.name ?? basename(caseDir);
  if (longerThan(name, EVAL_MAX_CASE_NAME)) {
    const source = promptFile?.fields.name !== undefined ? promptPath : caseFile?.fields.name !== undefined ? casePath : caseDir;
    findings.add("eval-case-invalid", source, `the case name ${quote(name)} is over ${EVAL_MAX_CASE_NAME} characters`);
  }

  const context = checkContext(index, caseDir, caseFiles, caseFile?.context ?? { addDirs: [] }, findings);
  const mocks = readCaseMocks(index, suite.dir, caseDir, suite.rule, findings, suite.findings, suite.reportedMocks);
  for (const server of mocks.servers) suite.mocked.add(server.server);

  if (!findings.empty || prompt === undefined) return undefined;

  const env = fields.env ?? {};
  const plugins = fields.plugins ?? [];
  const unsupported = unsupportedOf(caseDir, plugins, graders, suite.loadsPlugins);
  return {
    name,
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
    plugins,
    context,
    files,
    graders,
    mocks: mocks.servers,
    replays: mocks.replays,
    ...(unsupported !== undefined && { unsupported }),
  };
}

/**
 * A case-relative path, normalised: no `./`, no empty segment. `undefined`
 * when it is absolute, backslashed, or climbs with `..`, since every context
 * path must name something inside the case.
 */
function inCase(path: string): string | undefined {
  if (path.startsWith("/") || path.includes("\\")) return undefined;
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return undefined;
  return parts.join("/");
}

/** The case's `context`, its paths normalised and checked against its files (the module header). */
function checkContext(
  index: PluginFileIndex,
  caseDir: string,
  caseFiles: ReadonlySet<string>,
  context: EvalCaseContext,
  findings: CaseFindings,
): EvalCaseContext {
  const path = `${caseDir}/${CASE_FILE}`;
  const wrongPath = (field: string, expected: string, value: string): undefined => {
    findings.add("eval-case-invalid", path, `context.${field} must be ${expected} (${quote(value)} is not)`);
    return undefined;
  };
  const file = (field: string, value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const normalised = inCase(value);
    if (normalised === undefined || !caseFiles.has(`${caseDir}/${normalised}`)) {
      return wrongPath(field, "a file in the case directory", value);
    }
    return normalised;
  };
  const scaffoldScript = file("scaffold_script", context.scaffoldScript);
  let historyFile = file("history_file", context.historyFile);
  if (historyFile !== undefined) {
    if (!historyFile.endsWith(".jsonl")) {
      historyFile = wrongPath("history_file", "a .jsonl transcript", historyFile);
    } else {
      const text = readDocument(index, `${caseDir}/${historyFile}`, "eval-case-invalid", findings);
      const parsed = text === undefined ? undefined : parseTranscript(text, { requirePairing: true });
      if (parsed !== undefined && !parsed.ok) {
        findings.add("eval-case-invalid", `${caseDir}/${historyFile}`, `the conversation cannot be resumed: ${parsed.error}`);
      }
    }
  }
  const addDirs: string[] = [];
  for (const dir of context.addDirs) {
    const normalised = inCase(dir);
    if (normalised === undefined || !index.isDirectory(`${caseDir}/${normalised}`)) {
      wrongPath("add_dirs", "directories inside the case directory", dir);
    } else {
      addDirs.push(normalised);
    }
  }
  return {
    ...(scaffoldScript !== undefined && { scaffoldScript }),
    ...(historyFile !== undefined && { historyFile }),
    addDirs,
  };
}

/**
 * Whether `entry`, read relative to the plugin-relative `caseDir`, is the
 * plugin's root. Resolved lexically, segment by segment, the way the reader
 * sees the package: an absolute or backslashed path, or one that climbs
 * above the root on the way, names something outside the package read here.
 */
function namesPluginRoot(caseDir: string, entry: string): boolean {
  if (entry.startsWith("/") || entry.includes("\\")) return false;
  const resolved = caseDir.split("/");
  for (const segment of entry.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") resolved.push(segment);
    else if (resolved.pop() === undefined) return false;
  }
  return resolved.length === 0;
}

/**
 * A case's `plugins` names the plugins it runs with, relative to the case.
 * An entry that resolves to this plugin's root is the plugin under test, the
 * format's override of auto-detect; any other entry is a plugin Stigmer would
 * not attach, so the case does not run rather than score without it.
 */
function unsupportedOf(
  caseDir: string,
  plugins: readonly string[],
  graders: readonly EvalGrader[],
  loadsPlugins: boolean,
): EvalUnsupportedFeature | undefined {
  if (plugins.length > 0 && !loadsPlugins) return "plugins";
  if (!plugins.every((entry) => namesPluginRoot(caseDir, entry))) return "plugins";
  if (graders.length > EVAL_MAX_GRADERS) return "more than 32 graders";
  return undefined;
}
