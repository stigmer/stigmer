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
 * The pages show two targets in tabs, "On your machine" and "Stigmer Cloud"
 * (TARGET_TABS). A run reads one of them (`target`, the machine's by
 * default): everything inside the other target's `<Tab>` is skipped, files
 * and commands alike. The getting-started smoke runs the machine's; the
 * e2e first-hour journey runs the Cloud tab, against whichever server it
 * targets, so neither tab goes unrun.
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
 * A harness that installs the build's tarballs in place of a page's or a
 * handover's `npm install` line installs the rest of that line as written:
 * `registryPackagesOf` names the packages outside `@stigmer/*`, which the
 * tarballs stand in for, so a line that names one more package needs no
 * harness edit.
 *
 * A copy of a page's code elsewhere (the README, the homepage) quotes it
 * under one rule, kept here beside the parser it reads with: runs of the
 * page's consecutive lines, each gap marked by a `// …` line
 * (`elidedRuns`, `firstUnmarkedGap`), or single lines in the page's order
 * (`firstOutOfOrder`).
 *
 * A file is written as the reader copies it: without the hidden setup a
 * TypeScript, Go, Python or Java fence may open with, above its `---cut---`
 * line, split by the one function the site and the docs snippet gate use.
 *
 * Plain node, no dependencies, like its neighbours.
 */

import { splitSnippetSetup } from "../../../site/src/lib/snippet-setup.mjs";

/** The page's own lines the harness performs instead of running, each with what it does instead. */
export const HARNESS_LINES = Object.freeze([
  { line: "brew install stigmer/tap/stigmer", performs: "cli" },
  { line: "curl -fsSL https://stigmer.ai/install.sh | sh", performs: "cli" },
  { line: "npm install -g @stigmer/cli", performs: "cli" },
  { line: "npm install @stigmer/client @connectrpc/connect-node", performs: "sdk" },
  { line: "export ANTHROPIC_API_KEY=<your Anthropic API key>", performs: "model-key" },
  // The quickstart's Stigmer Cloud tab, run by test/e2e's first-hour journey:
  // the Organization the person just signed up to, which it reads, not types.
  { line: "stigmer config context set --org <your-org>", performs: "org-context" },
  // The embedding tutorial (embed-agent.mdx), run by test/e2e's embed-tutorial project.
  { line: "npm create vite@latest my-app -- --template react-ts", performs: "vite-app" },
  { line: "npm install @stigmer/react-sdk @stigmer/client @stigmer/apis @bufbuild/protobuf @connectrpc/connect-node", performs: "react-sdk" },
  { line: "npx tsx server.ts", performs: "backend" },
  { line: "VITE_STIGMER_ORG=$STIGMER_ORG npm run dev", performs: "dev-server" },
  // The terminal kit: its README and docs/sdk/ink/cli-integration.mdx, run by
  // test/install/smoke-terminal-kit.mjs with the kit this build packs.
  { line: "npm install @stigmer/ink-ui @stigmer/react-core @stigmer/client @stigmer/apis @bufbuild/protobuf ink react", performs: "ink-kit" },
  { line: "npm install --global @stigmer/ink-ui", performs: "ink-bin" },
]);

const NPM_INSTALL = /^npm (?:install|i)(?:\s+(.*))?$/;

/**
 * The packages an `npm install` line names outside `@stigmer/*`, in its
 * order: what a harness installs from the registry beside the build's
 * tarballs, as the reader's `npm install` would. Throws on a line that is not
 * a local `npm install` of named packages (a flag, a global install, a bare
 * `npm install`), which no harness performs this way.
 */
export function registryPackagesOf(line) {
  const match = NPM_INSTALL.exec(line.trim());
  const names = match?.[1]?.split(/\s+/).filter((word) => word !== "") ?? [];
  if (match === null || names.length === 0 || names.some((name) => name.startsWith("-"))) {
    throw new Error(`not an npm install of named packages: ${line}`);
  }
  return names.filter((name) => !name.startsWith("@stigmer/"));
}

/** The two targets a page shows in tabs; a run reads one and skips the other. */
export const TARGET_TABS = Object.freeze(["On your machine", "Stigmer Cloud"]);
/** The target a run reads unless it names one: the machine, which needs no account. */
export const DEFAULT_TARGET = TARGET_TABS[0];

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
 * `target` names the target tab the run reads (one of TARGET_TABS); the
 * other target's tab is skipped.
 * Throws on a fence left open, a command the harness cannot run as written,
 * or a target that is not one of TARGET_TABS.
 */
export function docSteps(mdx, { target = DEFAULT_TARGET } = {}) {
  if (!TARGET_TABS.includes(target)) throw new Error(`no target tab "${target}": one of ${TARGET_TABS.join(", ")}`);
  const skipped = TARGET_TABS.filter((tab) => tab !== target);
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
    if (tabs.some((tab) => skipped.includes(tab))) continue;
    const { language, title } = parseInfo(info);
    if (title !== undefined) {
      // The reader copies what the page shows: a hidden setup above the
      // `---cut---` line is the docs snippet gate's, never the reader's.
      steps.push({ kind: "file", path: title, content: `${splitSnippetSetup(language, body.join("\n")).body}\n` });
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

/** The line that marks lines left out of a quoted run. */
export const ELISION = "// …";

/** The runs of code lines between `// …` lines, blank lines left out. */
export function elidedRuns(lines) {
  const runs = [[]];
  for (const line of lines) {
    if (line.trim() === ELISION) runs.push([]);
    else if (line.trim() !== "") runs.at(-1).push(line);
  }
  return runs.filter((run) => run.length > 0);
}

/**
 * The first run that is not consecutive lines of `source` after the run
 * before it (blank source lines skipped), as its first line, or undefined.
 */
export function firstUnmarkedGap(runs, source) {
  const lines = source.filter((line) => line.trim() !== "");
  let from = 0;
  for (const run of runs) {
    let at = lines.indexOf(run[0], from);
    while (at !== -1 && run.some((line, i) => lines[at + i] !== line)) at = lines.indexOf(run[0], at + 1);
    if (at === -1) return run[0];
    from = at + run.length;
  }
  return undefined;
}

/** The first shown line that is not one of `source`'s lines after the line before it, or undefined. */
export function firstOutOfOrder(shown, source) {
  let from = 0;
  for (const line of shown) {
    const at = source.indexOf(line, from);
    if (at === -1) return line;
    from = at + 1;
  }
  return undefined;
}

/**
 * The body of the first fence of `language` in `markdown`'s section under
 * `## <heading>` (the section runs to the next `## ` heading); throws naming
 * what is missing. How a pin test reads the code a README or a page shows.
 */
export function firstFence(markdown, heading, language) {
  const section = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "mi").exec(markdown)?.[1];
  if (section === undefined) throw new Error(`no "## ${heading}" section`);
  const body = new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, "m").exec(section)?.[1];
  if (body === undefined) throw new Error(`no \`\`\`${language} fence under "## ${heading}"`);
  return body;
}
