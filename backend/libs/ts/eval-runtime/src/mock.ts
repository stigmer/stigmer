/**
 * A mock's answer, as the plugin-eval format writes it: a Markdown file
 * whose frontmatter configures the mock and whose body is what the tool
 * returns, with two substitutions.
 *
 *  - `{{input.<path>}}` inserts a field of the call's input, a dotted path;
 *    a string as written, anything else as JSON, a missing field as
 *    nothing.
 *  - `{{file:fixtures/<name>}}` inserts a file from the `fixtures/`
 *    directory beside the mock. The name may itself carry
 *    `{input.<path>}` in single braces, as in
 *    `{{file:fixtures/{input.order_id}.json}}`. The resolved name must
 *    stay inside `fixtures/`: an input that climbs out (`../x`) or names
 *    an absolute path is refused, and so is a missing file, as a tool
 *    error naming the fixture.
 *
 * The server reads frontmatter with the suite reader's YAML; the runner
 * only needs the body, which {@link mockBodyOf} cuts from the file text,
 * so this library carries no YAML parser.
 *
 * `_tools.json` is the server's saved `tools/list` response;
 * {@link parseToolsList} reads each tool's description and input schema
 * from it, so a mocked tool is offered as the real one is.
 */

/** A rendered answer, or why it cannot be rendered. */
export type MockRender =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/** The body of a mock file: everything after its frontmatter, when it has one. */
export function mockBodyOf(fileText: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(fileText);
  return (match === null ? fileText : fileText.slice(match[0].length)).trim();
}

/**
 * Render a fixed mock's body for one call. `readFixture` reads a path
 * relative to the mock's server directory (always under `fixtures/`), or
 * returns `undefined` when there is no such file.
 */
export function renderMockAnswer(
  body: string,
  input: unknown,
  readFixture: (path: string) => string | undefined,
): MockRender {
  let failure: string | undefined;
  const text = body.replace(/\{\{\s*(input\.[^{}\s]+|file:[^{}]*(?:\{[^{}]*\}[^{}]*)*)\s*\}\}/g, (_whole, ref: string) => {
    if (failure !== undefined) return "";
    if (ref.startsWith("input.")) return inputText(input, ref.slice("input.".length));
    const named = ref
      .slice("file:".length)
      .replace(/\{input\.([^}]+)\}/g, (_w, path: string) => inputText(input, path));
    const path = fixturePath(named);
    if (path === undefined) {
      failure = `the fixture '${named}' is outside the mock's fixtures directory`;
      return "";
    }
    const content = readFixture(path);
    if (content === undefined) {
      failure = `the fixture '${path}' does not exist`;
      return "";
    }
    return content;
  });
  return failure === undefined ? { ok: true, text } : { ok: false, error: failure };
}

/** `name` normalised under `fixtures/`, or `undefined` when it leaves it. */
export function fixturePath(name: string): string | undefined {
  if (name.startsWith("/") || name.includes("\\") || name.includes("\0")) return undefined;
  const parts: string[] = [];
  for (const part of name.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return undefined;
    parts.push(part);
  }
  if (parts[0] !== "fixtures" || parts.length < 2) return undefined;
  return parts.join("/");
}

function inputText(input: unknown, path: string): string {
  let current: unknown = input;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.hasOwn(current, key)) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === "string") return current;
  return JSON.stringify(current) ?? "";
}

/** One tool of a saved `tools/list` response. */
export interface SavedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

/**
 * Read a `_tools.json`: a `tools/list` result (`{"tools": [...]}`), the
 * JSON-RPC response around it (`{"result": {"tools": [...]}}`), or the bare
 * list. A tool without a string name is skipped; a file of none of these
 * shapes reads as no tools.
 */
export function parseToolsList(text: string): readonly SavedTool[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed["tools"])
      ? parsed["tools"]
      : isRecord(parsed) && isRecord(parsed["result"]) && Array.isArray(parsed["result"]["tools"])
        ? parsed["result"]["tools"]
        : [];
  const tools: SavedTool[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry["name"] !== "string") continue;
    tools.push({
      name: entry["name"],
      ...(typeof entry["description"] === "string" ? { description: entry["description"] } : {}),
      ...(isRecord(entry["inputSchema"]) ? { inputSchema: entry["inputSchema"] } : {}),
    });
  }
  return tools;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
