/**
 * The coding-agent door's pure parts (test/install/coding-agent-door.mjs):
 * its flags, the prompt read from the live docs page, and the npm flags that
 * name a registry. Split out so they are tested without starting a stack.
 *
 * The published walk reads its prompt from the page a person copies it from
 * (stigmer.ai's coding-agent page), never from this checkout: a page that no
 * longer carries it is a failure in plain words, not a silent fallback, so a
 * docs change that breaks the door is seen after the release that shipped it.
 *
 * Every npm read and install the published walk makes names its registries
 * on the command line: a machine's own npm config may route the @stigmer
 * scope elsewhere (a private registry), and a read that inherits it reports
 * the wrong registry's packages.
 *
 * The walk's app (`next dev`, started detached in its own process group) is
 * stopped with stopProcessGroup before the scratch folder is removed: Next
 * keeps writing `.next/` after SIGTERM, and a removal racing it fails with
 * ENOTEMPTY after the walk has passed (stigmer/stigmer#3154).
 *
 * A walk that fails prints a digest of the coding agent's stream
 * (streamDigest): every tool call Claude Code refused, and the last calls it
 * made; and the runner's lines of note (runnerLogNotes). The scratch folder
 * holding the stream and the server's and runner's logs is removed after the
 * run, so without them a red in CI says only which check failed, not what
 * the coding agent or the run did.
 *
 * Plain node, no dependencies, like its neighbours.
 */

/** The page a person copies the prompt from (docs/getting-started/coding-agent.mdx). */
export const PROMPT_PAGE = "https://stigmer.ai/docs/getting-started/coding-agent";
/** The prompt's first words, by which its code block is found on the page. */
export const PROMPT_START = "Set up Stigmer for this project.";
/** npm's public registry: the default for --registry, and where every non-Stigmer package comes from. */
export const NPM_REGISTRY = "https://registry.npmjs.org/";

export const USAGE = `Usage:
  node test/install/coding-agent-door.mjs [--local] [--keep] [--max-turns=<n>]
      [--published --version=<v> [--registry=<url>]]
      [--model=<name>] [--claude-max-turns=<n>] [--max-budget-usd=<usd>]
  --local                 a server that trusts every caller (the development chat)
  --keep                  keep the scratch folder (app, stream, CLI home)
  --max-turns=<n>         how many times to answer the coding agent (default 8)
  --published             the CLI, its coding-agent plugin and the app's Stigmer
                          packages from npm at --version, and the prompt from
                          ${PROMPT_PAGE}
  --version=<v>           the published version (with --published)
  --registry=<url>        where @stigmer/* is read from (default ${NPM_REGISTRY})
  --model=<name>          Claude Code's model (claude --model), e.g. haiku
  --claude-max-turns=<n>  Claude Code's own turn bound per prompt (claude --max-turns)
  --max-budget-usd=<usd>  Claude Code's spend bound per prompt (claude --max-budget-usd)
Claude Code runs on its own sign-in, or on DOOR_ANTHROPIC_API_KEY when set.`;

function positiveNumber(flag, text, { integer }) {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${flag} takes a positive ${integer ? "whole number" : "number"}, not ${JSON.stringify(text)}`);
  }
  return value;
}

/**
 * The door's options from its argv (without node and the script). Throws on
 * an unknown flag or a combination that cannot run, so a typo never walks a
 * different door than the one asked for.
 */
export function parseDoorArgs(argv) {
  const out = {
    help: false,
    keep: false,
    local: false,
    maxTurns: 8,
    published: false,
    version: "",
    registry: "",
    model: "",
    claudeMaxTurns: undefined,
    maxBudgetUsd: undefined,
  };
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    switch (flag) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--keep":
        out.keep = true;
        break;
      case "--local":
        out.local = true;
        break;
      case "--published":
        out.published = true;
        break;
      case "--max-turns":
        out.maxTurns = positiveNumber(flag, value ?? "", { integer: true });
        break;
      case "--version":
        out.version = (value ?? "").replace(/^v/, "");
        break;
      case "--registry":
        out.registry = value ?? "";
        break;
      case "--model":
        out.model = value ?? "";
        break;
      case "--claude-max-turns":
        out.claudeMaxTurns = positiveNumber(flag, value ?? "", { integer: true });
        break;
      case "--max-budget-usd":
        out.maxBudgetUsd = positiveNumber(flag, value ?? "", { integer: false });
        break;
      default:
        throw new Error(`unknown argument ${arg}\n${USAGE}`);
    }
  }
  if (out.help) return out;
  if (out.published && out.version === "") throw new Error("--published needs --version=<v>, the published version to walk");
  if (!out.published && (out.version !== "" || out.registry !== "")) throw new Error("--version and --registry apply only with --published");
  if (out.published) {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(out.version)) throw new Error(`--version is not a version: ${JSON.stringify(out.version)}`);
    out.registry = normalizeRegistry(out.registry === "" ? NPM_REGISTRY : out.registry);
  }
  if (out.model === "" && argv.some((arg) => arg.startsWith("--model="))) throw new Error("--model needs a model name");
  return out;
}

/** A registry URL with exactly one trailing slash, as npm's config writes it; anything but http(s) is refused. */
export function normalizeRegistry(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`--registry is not a URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`--registry must be http(s): ${url}`);
  return `${parsed.href.replace(/\/+$/, "")}/`;
}

/**
 * The npm flags that name both registries for one command: @stigmer/* from
 * `registry`, everything else from npm's public registry. Flags outrank every
 * npmrc, so the machine's own config cannot reroute the read.
 */
export function npmRegistryFlags(registry) {
  return [`--registry=${NPM_REGISTRY}`, `--@stigmer:registry=${registry}`];
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * A block's text with every tag gone, removed until none is left, so a tag
 * that removing another one forms (`<<b>pre>`) never survives. The text is
 * read as plain words, never put back into a page.
 */
export function withoutTags(html) {
  let text = html;
  for (;;) {
    const next = text.replace(/<[^>]*>/g, "");
    if (next === text) return text;
    text = next;
  }
}

/**
 * The prompt the served page shows in its code block: the one `<pre>` whose
 * text starts with the prompt's first words, its lines joined with single
 * spaces (the page wraps the prompt at its source's line width; a person's
 * paste is one paragraph to the coding agent either way). Throws, in words a
 * reader of the job log can act on, when no block or more than one distinct
 * block carries it.
 */
export function promptFromPage(html, { page = PROMPT_PAGE } = {}) {
  const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)].map((match) =>
    decodeEntities(withoutTags(match[1]))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .join(" ")
      .replace(/\s+/g, " "),
  );
  const prompts = [...new Set(blocks.filter((text) => text.startsWith(PROMPT_START)))];
  if (prompts.length === 0) {
    throw new Error(
      `${page} carries no code block that starts with "${PROMPT_START}" (${blocks.length} code blocks read): the page a person copies the prompt from has lost it or changed its shape`,
    );
  }
  if (prompts.length > 1) {
    throw new Error(`${page} carries ${prompts.length} different prompts that start with "${PROMPT_START}"; which one a person copies is not clear:\n${prompts.join("\n")}`);
  }
  return prompts[0];
}

/** The prompt from the live page: it must answer 200 and carry exactly one prompt. */
export async function fetchPagePrompt({ page = PROMPT_PAGE, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(page, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  } catch (error) {
    throw new Error(`could not read the prompt's page ${page}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status !== 200) throw new Error(`the prompt's page ${page} answered HTTP ${response.status}, not 200`);
  return promptFromPage(await response.text(), { page });
}

/** Whether any process of the group led by `pid` is still alive (signal 0 probes without signalling). */
function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a detached child's whole process group and wait until no member is
 * left: SIGTERM, then SIGKILL after `graceMs`. Resolves to how it ended
 * ("gone" when nothing was running, "terminated", or "killed"); a folder the
 * group wrote into is safe to remove once it resolves.
 */
export async function stopProcessGroup(child, { graceMs = 10_000, pollMs = 50 } = {}) {
  const pid = child?.pid;
  if (pid === undefined || !groupAlive(pid)) return "gone";
  const waitGone = async (ms) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (!groupAlive(pid)) return true;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return !groupAlive(pid);
  };
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return "gone";
  }
  if (await waitGone(graceMs)) return "terminated";
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    return "terminated";
  }
  if (await waitGone(5_000)) return "killed";
  throw new Error(`process group ${pid} still has members after SIGKILL`);
}

/** One line of a digest: whitespace folded, at most `max` characters. */
function oneLine(text, max = 240) {
  const line = String(text).replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * A failed walk's account of what the coding agent did, from its stream-json:
 * each tool call Claude Code refused (a result saying it "requires approval"),
 * with the call and the refusal, then the last `last` calls. Pure.
 */
export function streamDigest(streamText, { last = 12 } = {}) {
  const calls = new Map();
  const order = [];
  const refused = [];
  for (const raw of streamText.split("\n")) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "tool_use") {
        const call = `${part.name} ${typeof part.input?.command === "string" ? part.input.command : JSON.stringify(part.input ?? {})}`;
        calls.set(part.id, call);
        order.push(call);
      } else if (part?.type === "tool_result") {
        const text = typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "");
        if (/requires approval/.test(text)) refused.push(`refused: ${oneLine(calls.get(part.tool_use_id) ?? "(unknown call)")} -> ${oneLine(text, 160)}`);
      }
    }
  }
  return [
    `the coding agent made ${order.length} tool call(s), ${refused.length} refused`,
    ...refused,
    ...order.slice(-last).map((call, i, shown) => `call ${order.length - shown.length + i + 1}: ${oneLine(call)}`),
  ];
}

/**
 * A failed walk's lines of note from the runner's log: its warnings, errors
 * and anything about outputs or uploads, the last `last` of them, without
 * Node's experimental-feature notices and the model registry's retries,
 * which every walk prints. Pure.
 */
export function runnerLogNotes(logText, { last = 20 } = {}) {
  const notes = logText
    .split("\n")
    .filter((line) => /\b(warn|warning|error|failed|output|outputs|upload)\b/i.test(line))
    .filter((line) => !/ExperimentalWarning|--trace-warnings|model registry|No workflows registered/.test(line))
    .map((line) => oneLine(line));
  return notes.slice(-last);
}

/**
 * What the walk's fake model has the example agent do, for the example a
 * coding agent picks for the walk's invoices app (examples/invoice-match):
 * its first run saves the file the agent's instructions name, holding the
 * true answer for the example's own samples, and every later turn answers
 * in the same words. A coding agent reads both and checks them against the
 * samples: an answer that is wrong, or that reads as no model's, stops it
 * before the chat, as it should for a person (stigmer/stigmer#3160). The
 * suite recomputes the answer from the samples.
 */
export const DOOR_FILE = "mismatches.md";
export const DOOR_REPORT = [
  "Total at stake: 940.00",
  "",
  "| SKU | Order | Invoice | At stake |",
  "|---|---|---|---|",
  "| SRV-01 | not ordered | 1 × 450.00 | 450.00 |",
  "| CHR-310 | 12 × 210.00 | 12 × 235.00 | 300.00 |",
  "| DSK-121 | 10 × 95.00 | 12 × 95.00 | 190.00 |",
  "",
].join("\n");
export const DOOR_REPLY =
  "I checked invoice-4471 against po-2210 and saved mismatches.md: 940.00 is at stake on three lines. " +
  "SRV-01 (assembly and delivery, 450.00) was never ordered; CHR-310 is billed at 235.00 against the agreed 210.00, 300.00 over; " +
  "and DSK-121 bills 12 desk tops where 10 were ordered, 190.00 over.";
