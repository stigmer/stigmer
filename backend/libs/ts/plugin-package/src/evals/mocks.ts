/**
 * A case's MCP mocks, in the plugin-eval format's layout: the suite's
 * `<suite>/mocks/<server>/` and the case's own `<case>/mocks/<server>/`,
 * merged file by file with the case's file winning, so a case overrides
 * one tool and keeps the suite's others.
 *
 * In a server's directory:
 *  - `<tool>.md`: one tool. Frontmatter `type` (`fixed`, the default, or
 *    `agent`), `expect`, `error` (`fixed` only) and `abort_when` (`agent`
 *    only); the body answers.
 *  - `_server.md`: one `agent` mock for the tools its `tools:` key lists; a
 *    `<tool>.md` for the same tool takes precedence. Its `expect:` is
 *    accepted only when `tools:` lists one tool.
 *  - `_tools.json`: the real server's saved `tools/list`, recorded by path
 *    for the runner to offer real descriptions and schemas.
 *  - `fixtures/`: files a body inserts; the runner resolves them, case
 *    directory first.
 * `mocks/.replay/` holds adopted agent-mock recordings, which Stigmer does
 * not read; the case only notes that it has them.
 *
 * A file that breaks these rules (an unknown key, a wrong type, an `expect`
 * pattern outside the dialect) is an `eval-mock-invalid` finding of the
 * case, which then does not load, as Claude Code stops such a case. Which
 * servers a suite may mock is its reader's rule ({@link MockServerRule}): a
 * plugin's suite mocks only the servers the plugin declares, a pushed
 * folder any server whose name could be one. A directory the rule refuses
 * is a finding of the suite and is ignored: no try could reach that server.
 */

import { compileExpect } from "@stigmer/eval-runtime";
import { isJsonObject, type JsonObject } from "../documents.js";
import { comparePaths, joinPath, type PluginFileIndex } from "../files.js";
import { type CaseFindings, type FieldScope, readNonEmptyString, readStringList, unknownKeys, wrong } from "./fields.js";
import { readMarkdown } from "./markdown.js";
import type { EvalMockServer, EvalMockTool, EvalSuiteFinding } from "./types.js";

/** The directory under the suite or a case that holds mocks. */
export const MOCKS_DIR = "mocks";

/** Adopted agent-mock recordings, under a mocks directory. */
const REPLAY_DIR = ".replay";

const SERVER_FILE = "_server.md";
const TOOLS_FILE = "_tools.json";

const TOOL_KEYS: ReadonlySet<string> = new Set(["type", "expect", "error", "abort_when"]);
const SERVER_KEYS: ReadonlySet<string> = new Set(["type", "tools", "expect", "abort_when"]);

/** What a case's mocks read to: the servers, and whether replays exist. */
export interface CaseMocks {
  readonly servers: readonly EvalMockServer[];
  readonly replays: boolean;
}

/**
 * Whether a suite may mock the server a mock directory names: `undefined`
 * keeps the directory, a sentence says why it is ignored.
 */
export type MockServerRule = (server: string) => string | undefined;

/**
 * Read the mocks one case sees. A mock directory `rule` refuses adds a
 * finding to `suiteFindings` (once per directory: `reported` remembers the
 * suite's) and is skipped.
 */
export function readCaseMocks(
  index: PluginFileIndex,
  suiteDir: string,
  caseDir: string,
  rule: MockServerRule,
  findings: CaseFindings,
  suiteFindings: EvalSuiteFinding[],
  reported: Set<string>,
): CaseMocks {
  const suiteMocks = joinPath(suiteDir, MOCKS_DIR);
  const caseMocks = `${caseDir}/${MOCKS_DIR}`;
  const replays = index.isDirectory(`${suiteMocks}/${REPLAY_DIR}`) || index.isDirectory(`${caseMocks}/${REPLAY_DIR}`);
  const names = new Set([...index.childDirectories(suiteMocks), ...index.childDirectories(caseMocks)]);
  names.delete(REPLAY_DIR);
  const servers: EvalMockServer[] = [];
  for (const server of [...names].sort(comparePaths)) {
    const problem = rule(server);
    if (problem !== undefined) {
      for (const dir of [`${suiteMocks}/${server}`, `${caseMocks}/${server}`]) {
        if (!index.isDirectory(dir) || reported.has(dir)) continue;
        reported.add(dir);
        suiteFindings.push({ kind: "eval-mock-invalid", path: dir, message: `${dir}: ${problem}` });
      }
      continue;
    }
    const read = readServer(index, `${suiteMocks}/${server}`, `${caseMocks}/${server}`, server, findings);
    if (read !== undefined) servers.push(read);
  }
  return { servers, replays };
}

/** One server's mocks, the case's files over the suite's. */
function readServer(
  index: PluginFileIndex,
  suiteDir: string,
  caseDir: string,
  server: string,
  findings: CaseFindings,
): EvalMockServer | undefined {
  const files = new Map<string, string>();
  for (const dir of [suiteDir, caseDir]) {
    for (const file of index.childFiles(dir)) files.set(file, `${dir}/${file}`);
  }
  const tools = new Map<string, EvalMockTool>();
  for (const [file, path] of [...files].sort(([a], [b]) => comparePaths(a, b))) {
    if (!file.endsWith(".md") || file.startsWith("_")) continue;
    const tool = readToolMock(index, path, file.slice(0, -".md".length), findings);
    if (tool !== undefined) tools.set(tool.tool, tool);
  }
  const serverPath = files.get(SERVER_FILE);
  if (serverPath !== undefined) {
    for (const tool of readServerMock(index, serverPath, findings)) {
      if (!tools.has(tool.tool)) tools.set(tool.tool, tool);
    }
  }
  const toolsFile = files.get(TOOLS_FILE);
  return {
    server,
    tools: [...tools.values()].sort((a, b) => comparePaths(a.tool, b.tool)),
    ...(toolsFile !== undefined && { toolsFile }),
  };
}

function scopeOf(path: string, findings: CaseFindings): FieldScope {
  return { path, label: "", invalid: "eval-mock-invalid", findings };
}

function readToolMock(index: PluginFileIndex, path: string, tool: string, findings: CaseFindings): EvalMockTool | undefined {
  const scope = scopeOf(path, findings);
  const document = readMarkdown(index, scope);
  if (document === undefined) return undefined;
  const { fields } = document;
  unknownKeys(fields, TOOL_KEYS, scope, "eval-mock-invalid", "frontmatter key");
  const kind = readKind(fields["type"], scope);
  const error = fields["error"];
  if (error !== undefined && typeof error !== "boolean") wrong(scope, "error", "true or false");
  if (error === true && kind === "agent") wrong(scope, "error", "unset on an agent mock (it applies to fixed mocks)");
  const abortWhen = readNonEmptyString(fields, "abort_when", scope);
  if (abortWhen !== undefined && kind === "fixed") wrong(scope, "abort_when", "unset on a fixed mock (it applies to agent mocks)");
  const expect = readExpect(fields["expect"], scope);
  if (kind === undefined) return undefined;
  return {
    tool,
    file: path,
    kind,
    error: error === true,
    ...(expect !== undefined && { expect }),
    ...(abortWhen !== undefined && { abortWhen }),
  };
}

/** `_server.md`'s tools, each answered by it as an agent. */
function readServerMock(index: PluginFileIndex, path: string, findings: CaseFindings): readonly EvalMockTool[] {
  const scope = scopeOf(path, findings);
  const document = readMarkdown(index, scope);
  if (document === undefined) return [];
  const { fields } = document;
  unknownKeys(fields, SERVER_KEYS, scope, "eval-mock-invalid", "frontmatter key");
  const kind = readKind(fields["type"] ?? "agent", scope);
  if (kind === "fixed") wrong(scope, "type", "agent (a _server.md answers as an agent)");
  const tools = readStringList(fields, "tools", scope);
  if (tools === undefined || tools.length === 0) {
    if (fields["tools"] === undefined || tools !== undefined) wrong(scope, "tools", "a list of the tools it answers");
    return [];
  }
  const expect = readExpect(fields["expect"], scope);
  if (expect !== undefined && tools.length !== 1) {
    wrong(scope, "expect", "on a tool's own <tool>.md when tools lists more than one tool");
  }
  const abortWhen = readNonEmptyString(fields, "abort_when", scope);
  return tools.map((tool) => ({
    tool,
    file: path,
    kind: "agent" as const,
    error: false,
    ...(expect !== undefined && tools.length === 1 && { expect }),
    ...(abortWhen !== undefined && { abortWhen }),
  }));
}

function readKind(value: unknown, scope: FieldScope): "fixed" | "agent" | undefined {
  if (value === undefined || value === "fixed") return "fixed";
  if (value === "agent") return "agent";
  return wrong(scope, "type", "fixed or agent");
}

/** An `expect:` block, compiled once so a pattern outside the dialect stops the case here. */
function readExpect(value: unknown, scope: FieldScope): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return wrong(scope, "expect", "a map from input paths to rules");
  const compiled = compileExpect(value);
  if (!compiled.ok) {
    scope.findings.add(scope.invalid, scope.path, compiled.error);
    return undefined;
  }
  return value;
}
