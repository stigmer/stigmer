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
 * The prompt the served page shows in its code block: the one `<pre>` whose
 * text starts with the prompt's first words, its lines joined with single
 * spaces (the page wraps the prompt at its source's line width; a person's
 * paste is one paragraph to the coding agent either way). Throws, in words a
 * reader of the job log can act on, when no block or more than one distinct
 * block carries it.
 */
export function promptFromPage(html, { page = PROMPT_PAGE } = {}) {
  const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)].map((match) =>
    decodeEntities(match[1].replace(/<[^>]*>/g, ""))
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
