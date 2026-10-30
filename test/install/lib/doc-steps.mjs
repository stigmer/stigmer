/**
 * The steps a Getting Started page asks its reader to take, read from the
 * page itself, so the smoke that runs them (test/install/smoke-getting-started.mjs)
 * has no copy of the page to keep in step.
 *
 * A page is MDX. Its steps are its fenced blocks, in document order:
 *   - a fence titled with a filename (```yaml title="agent.yaml") is a file
 *     the reader creates: write it;
 *   - a `bash` fence is commands the reader types, one per line: run them.
 * Every other fence (sample output, a fragment to splice into a file) is the
 * page talking, not a step.
 *
 * The pages show two targets in tabs, "On your machine" and "Stigmer Cloud".
 * The smoke runs the first; everything inside a `<Tab value="Stigmer Cloud">`
 * is skipped, files and commands alike.
 *
 * A few lines are the install's, not the page's: they install the CLI or the
 * SDK, or hand Stigmer a model key. The page shows them; the harness performs
 * them its own way (the build under test, the fake model's key). Each is
 * matched exactly and named in HARNESS_LINES with what the harness does
 * instead. Any other command that holds a placeholder (`<your-org>`, `…`)
 * fails the parse, and so does any other line that installs the CLI, so a
 * page cannot drift into a step the smoke silently skips or one that would
 * install something other than the build under test.
 *
 * Plain node, no dependencies, like its neighbours.
 */

/** The page's own lines the harness performs instead of running, each with what it does instead. */
export const HARNESS_LINES = Object.freeze([
  { line: "brew install stigmer/tap/stigmer", performs: "cli" },
  { line: "curl -fsSL https://stigmer.ai/install.sh | sh", performs: "cli" },
  { line: "npm install -g @stigmer/cli", performs: "cli" },
  { line: "npm install @stigmer/client", performs: "sdk" },
  { line: "export ANTHROPIC_API_KEY=<your Anthropic API key>", performs: "model-key" },
  // The embedding tutorial (embed-agent.mdx), run by test/e2e's embed-tutorial project.
  { line: "npm create vite@latest my-app -- --template react-ts", performs: "vite-app" },
  { line: "npm install @stigmer/react-sdk @stigmer/client @stigmer/apis @bufbuild/protobuf", performs: "react-sdk" },
  { line: "npx tsx server.ts", performs: "backend" },
  { line: "VITE_STIGMER_ORG=$STIGMER_ORG npm run dev", performs: "dev-server" },
  // The terminal kit: its README and docs/sdk/ink/cli-integration.mdx, run by
  // test/install/smoke-terminal-kit.mjs with the kit this build packs.
  { line: "npm install @stigmer/ink-ui @stigmer/react-core @stigmer/client @stigmer/apis @bufbuild/protobuf ink react", performs: "ink-kit" },
  { line: "npm install --global @stigmer/ink-ui", performs: "ink-bin" },
]);

/** The tab the smoke never runs: the hosted target, which needs an account. */
export const SKIPPED_TAB = "Stigmer Cloud";

const PLACEHOLDER = /<[^<>\s][^<>]*>|…/;
const CLI_INSTALL = /\bbrew install\b|install\.sh|npm (?:install|i) (?:-g|--global)\b/;
const FENCE = /^(\s*)(`{3,})(.*)$/;
const TAB_OPEN = /<Tab\s+value="([^"]*)"\s*>/;
const TAB_CLOSE = /<\/Tab>/;

/**
 * The steps of `mdx` in document order:
 *   { kind: "file", path, content }      write `content` at `path`
 *   { kind: "command", line }            run `line` in bash
 *   { kind: "harness", line, performs }  the harness performs it (HARNESS_LINES' `performs`)
 * Throws on a fence left open, or a command the harness cannot run as written.
 */
export function docSteps(mdx) {
  const lines = mdx.split("\n");
  const steps = [];
  const tabs = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const fence = FENCE.exec(text);
    if (fence === null) {
      trackTabs(text, tabs);
      continue;
    }
    const [, indent, ticks, info] = fence;
    const opened = i + 1;
    const body = [];
    let closed = false;
    for (i += 1; i < lines.length; i++) {
      if (lines[i].trim() === ticks) {
        closed = true;
        break;
      }
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
    }
    if (!closed) throw new Error(`the fence opened at line ${opened} never closes`);
    if (tabs.includes(SKIPPED_TAB)) continue;
    const { language, title } = parseInfo(info);
    if (title !== undefined) {
      steps.push({ kind: "file", path: title, content: `${body.join("\n")}\n` });
    } else if (language === "bash") {
      for (const line of body) steps.push(...commandStep(line));
    }
  }
  return steps;
}

/** The fence's language and its `title` attribute, from its info string. */
export function parseInfo(info) {
  const trimmed = info.trim();
  const language = trimmed.split(/\s+/)[0] ?? "";
  const title = /(?:^|\s)title="([^"]+)"/.exec(trimmed)?.[1];
  return { language, title };
}

function commandStep(raw) {
  const line = raw.trim();
  if (line === "" || line.startsWith("#")) return [];
  const harness = HARNESS_LINES.find((entry) => entry.line === line);
  if (harness !== undefined) return [{ kind: "harness", line, performs: harness.performs }];
  if (PLACEHOLDER.test(line)) {
    throw new Error(`the command holds a placeholder the smoke cannot fill: ${line}`);
  }
  if (CLI_INSTALL.test(line)) {
    throw new Error(`the command installs the CLI in a way HARNESS_LINES does not name: ${line}`);
  }
  return [{ kind: "command", line }];
}

// A `<Tab value="...">` opens a tab and `</Tab>` closes the innermost; a line
// may hold both, as a one-line tab does.
function trackTabs(text, tabs) {
  let rest = text;
  for (;;) {
    const open = TAB_OPEN.exec(rest);
    const close = TAB_CLOSE.exec(rest);
    if (open === null && close === null) return;
    if (open !== null && (close === null || open.index < close.index)) {
      tabs.push(open[1]);
      rest = rest.slice(open.index + open[0].length);
    } else {
      tabs.pop();
      rest = rest.slice(close.index + close[0].length);
    }
  }
}
