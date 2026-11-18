// The public docs reader: finds a page in stigmer.ai's index (llms.txt) and
// reads its Markdown export whole, so an agent answers from what the docs say
// today and cites the page.
//
// Two front ends share it: the tool server's search_docs and read_doc tools,
// and the CLI's `stigmer docs` command, which imports this file alone through
// the `@stigmer/mcp-server/docs` subpath. So it imports nothing: no MCP SDK,
// no API stubs, only Node's globals.
//
// It reads stigmer.ai/docs and nothing else. On the hosted tool server a page
// argument is an agent's input, so a page that resolves anywhere else, or a
// redirect that leaves the docs, is refused rather than fetched: the tool can
// never be turned into a general fetcher. Every read is bounded in time and
// size. There is no search index: the site's llms.txt lists every page with a
// one-line description, and is small enough to score line by line. A read the
// site doesn't answer in time is tried once more, each try bounded.

/** The one origin the reader fetches from. */
export const DOCS_ORIGIN = "https://stigmer.ai";

/** The docs index: every page, its title and one line about it. */
export const DOCS_INDEX_URL = `${DOCS_ORIGIN}/llms.txt`;

/** How long one try at a read may take, start to end. */
export const DOCS_TIMEOUT_MS = 15_000;

/**
 * How many times a read is tried when the site doesn't answer in time or
 * can't be reached. The site's CDN has been seen stalling a page for 40 s
 * and answering the same page in half a second on the next request.
 */
export const DOCS_ATTEMPTS = 2;

/** The largest body read; the index is about 40 KB, a page far less. */
export const DOCS_MAX_BYTES = 2 * 1024 * 1024;

/** How long a process reuses the index it fetched; the docs change per push to main. */
export const DOCS_INDEX_TTL_MS = 5 * 60 * 1000;

/** The most pages a search returns. */
export const DOCS_SEARCH_LIMIT = 10;

/** The most redirects a read follows, each one checked. */
const MAX_REDIRECTS = 5;

/** A page in the index. */
export interface DocsHit {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

/** A page read whole: its address and its Markdown export, unchanged. */
export interface DocPage {
  readonly url: string;
  readonly markdown: string;
}

/** Why a read failed, for a caller that words the failure its own way. */
export type DocsErrorKind = "refused" | "not-found" | "unreachable" | "too-large" | "bad-answer";

/** A read that could not be done; its message is written for the person or agent who asked. */
export class DocsError extends Error {
  readonly kind: DocsErrorKind;

  constructor(kind: DocsErrorKind, message: string) {
    super(message);
    this.name = "DocsError";
    this.kind = kind;
  }
}

/** What a reader is built from; every field has a default. */
export interface DocsReaderOptions {
  /** The fetch to use; tests inject one, so no test reaches the network. */
  readonly fetch?: typeof fetch;
  /** The clock the index cache reads. */
  readonly now?: () => number;
  /** The environment the proxy hint reads. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Search the docs index and read pages from it. */
export interface DocsReader {
  /** The pages that best match the words, best first, at most {@link DOCS_SEARCH_LIMIT}. */
  searchDocs(query: string): Promise<DocsHit[]>;
  /** One page's Markdown export, whole. Takes `concepts/tools`, `/docs/concepts/tools` or the full URL, with or without `.md`. */
  readDocPage(page: string): Promise<DocPage>;
}

/** Build a reader; it keeps the index it fetched for {@link DOCS_INDEX_TTL_MS}. */
export function createDocsReader(options: DocsReaderOptions = {}): DocsReader {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  let cached: { readonly at: number; readonly hits: DocsHit[] } | undefined;

  const index = async (): Promise<DocsHit[]> => {
    if (cached !== undefined && now() - cached.at < DOCS_INDEX_TTL_MS) return cached.hits;
    const hits = parseIndex(await fetchText(doFetch, DOCS_INDEX_URL, env));
    cached = { at: now(), hits };
    return hits;
  };

  return {
    async searchDocs(query) {
      return rankDocs(await index(), query);
    },
    async readDocPage(page) {
      const url = docPageUrl(page);
      return { url, markdown: await fetchText(doFetch, `${url}.md`, env) };
    },
  };
}

let shared: DocsReader | undefined;

/** The process's one reader, so a long-running server fetches the index once per {@link DOCS_INDEX_TTL_MS}. */
export function sharedDocsReader(): DocsReader {
  shared ??= createDocsReader();
  return shared;
}

/** The index's page lines (`- [title](url): description`), in order. Pure. */
export function parseIndex(text: string): DocsHit[] {
  const hits: DocsHit[] = [];
  for (const line of text.split("\n")) {
    const match = /^- \[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?$/.exec(line.trim());
    if (match === null) continue;
    hits.push({ title: match[1] ?? "", url: match[2] ?? "", description: (match[3] ?? "").trim() });
  }
  return hits;
}

/** Words that say nothing about which page answers. */
const STOP_WORDS = new Set([
  "a", "about", "after", "all", "an", "and", "any", "are", "as", "at", "be", "before", "but", "by", "can",
  "could", "do", "does", "for", "from", "get", "have", "how", "i", "if", "in", "into", "is", "it", "its",
  "me", "my", "need", "not", "of", "on", "or", "over", "should", "so", "stigmer", "than", "that", "the",
  "then", "there", "they", "this", "to", "under", "use", "using", "via", "want", "we", "what", "when",
  "where", "which", "who", "why", "will", "with", "without", "would", "you", "your",
]);

/** A text's words, lower-cased, split at anything that is not a letter or digit. Pure. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** A word without its plural ending, so "ports" finds "port" and "harnesses" finds "harness". Pure. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (/(?:ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The words of a query that can tell pages apart. Pure. */
export function queryWords(query: string): string[] {
  return [...new Set(wordsOf(query).filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
}

/**
 * Whether a query word is one of a text's words: the same word, singular or
 * plural, or, for a word of four letters or more, the start of one ("auth"
 * finds "authentication"). Whole words only, so "port" never finds
 * "report" and "up" never finds "upload". Pure.
 */
function hasWord(words: readonly string[], word: string): boolean {
  const wanted = stem(word);
  return words.some((w) => stem(w) === wanted || (word.length >= 4 && w.startsWith(word)));
}

/**
 * The pages that match the most of the query's words, best first. A word in
 * the title counts most, then in the page's path, then in its description; a
 * page matching more distinct words always ranks above one matching fewer.
 * Words match whole ({@link hasWord}). Among pages matching as many, one
 * whose whole title the query holds ranks first, so a question naming
 * `stigmer up` finds that command's page. Pages that match none are left
 * out. Pure.
 */
export function rankDocs(hits: readonly DocsHit[], query: string, limit = DOCS_SEARCH_LIMIT): DocsHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const asked = wordsOf(query);
  const scored = hits.map((hit, order) => {
    const title = wordsOf(hit.title);
    const path = wordsOf(hit.url.replace(/^https?:\/\/[^/]+/, ""));
    const description = wordsOf(hit.description);
    let matched = 0;
    let weight = 0;
    for (const word of words) {
      const w = (hasWord(title, word) ? 3 : 0) + (hasWord(path, word) ? 2 : 0) + (hasWord(description, word) ? 1 : 0);
      if (w > 0) matched += 1;
      weight += w;
    }
    const named = title.length > 0 && title.every((word) => asked.some((a) => stem(a) === stem(word)));
    return { hit, order, score: matched * 100 + (named ? 50 : 0) + weight };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.hit);
}

/**
 * The docs URL a page argument names, without `.md`; throws a refused
 * {@link DocsError} for anything outside stigmer.ai/docs. Pure.
 */
export function docPageUrl(page: string): string {
  const refuse = (): never => {
    throw new DocsError("refused", `Only pages under ${DOCS_ORIGIN}/docs are read; "${page}" is not one.`);
  };
  let text = page.trim();
  if (text === "") refuse();
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return refuse();
    }
    if (url.origin !== DOCS_ORIGIN) refuse();
    path = url.pathname;
  } else {
    text = text.replace(/[?#].*$/, "");
    const relative = text.replace(/^\/+/, "");
    path = relative === "docs" || relative.startsWith("docs/") ? `/${relative}` : `/docs/${relative}`;
    path = new URL(path, DOCS_ORIGIN).pathname;
  }
  path = path.replace(/\/+$/, "").replace(/\.md$/, "");
  if (!/^\/docs(\/[A-Za-z0-9._-]+)*$/.test(path) || path.split("/").some((segment) => segment === "." || segment === "..")) {
    refuse();
  }
  return `${DOCS_ORIGIN}${path}`;
}

/** Whether a fetched address is one the reader may read from. Pure. */
export function isDocsAddress(url: string): boolean {
  return url === DOCS_INDEX_URL || url.startsWith(`${DOCS_ORIGIN}/docs/`);
}

/** The search's answer as text: a numbered line per page, then how to read one. Pure. */
export function formatHits(query: string, hits: readonly DocsHit[]): string {
  if (hits.length === 0) {
    return `No docs page matches "${query}". Try fewer or other words, or read ${DOCS_INDEX_URL} whole.`;
  }
  const lines = hits.map((hit, i) => {
    const head = `${i + 1}. ${hit.title}: ${hit.url}`;
    return hit.description === "" ? head : `${head}\n   ${hit.description}`;
  });
  return lines.join("\n");
}

/**
 * GET one address as text, tried up to {@link DOCS_ATTEMPTS} times while
 * the site can't be reached or doesn't answer in time; any other failure
 * (a refusal, a missing page, an error status, a body past the cap) is
 * final at once.
 */
async function fetchText(
  doFetch: typeof fetch,
  address: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchOnce(doFetch, address, env);
    } catch (error) {
      if (!(error instanceof DocsError) || error.kind !== "unreachable" || attempt >= DOCS_ATTEMPTS) throw error;
    }
  }
}

/**
 * GET one address as text once, following redirects only while they stay
 * on a docs address, within the time and size bounds.
 */
async function fetchOnce(
  doFetch: typeof fetch,
  address: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const signal = AbortSignal.timeout(DOCS_TIMEOUT_MS);
  let url = address;
  for (let hop = 0; ; hop += 1) {
    if (!isDocsAddress(url)) {
      throw new DocsError("refused", `A docs read was redirected away from ${DOCS_ORIGIN}/docs (to ${url}); not followed.`);
    }
    let response: Response;
    try {
      response = await doFetch(url, { redirect: "manual", signal, headers: { accept: "text/markdown, text/plain" } });
    } catch (error) {
      throw new DocsError("unreachable", unreachableMessage(error, env));
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || hop >= MAX_REDIRECTS) {
        throw new DocsError("bad-answer", `${DOCS_ORIGIN} answered ${response.status} for ${url} with no usable redirect.`);
      }
      url = new URL(location, url).toString();
      continue;
    }
    if (response.status === 404) {
      throw new DocsError(
        "not-found",
        `No docs page at ${url.replace(/\.md$/, "")}. Search the docs for the page's path first; a page's path is its URL after ${DOCS_ORIGIN}/docs/.`,
      );
    }
    if (!response.ok) {
      throw new DocsError("bad-answer", `${DOCS_ORIGIN} answered ${response.status} for ${url}.`);
    }
    return readBounded(response, url);
  }
}

/** The body as text, refusing one past {@link DOCS_MAX_BYTES}. */
async function readBounded(response: Response, url: string): Promise<string> {
  const tooLarge = () => new DocsError("too-large", `${url} is larger than ${DOCS_MAX_BYTES} bytes; not read.`);
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > DOCS_MAX_BYTES) throw tooLarge();
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let next: Awaited<ReturnType<typeof reader.read>>;
    try {
      next = await reader.read();
    } catch (error) {
      throw new DocsError("unreachable", `Reading ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (next.done) break;
    size += next.value.byteLength;
    if (size > DOCS_MAX_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** Why the docs couldn't be reached, naming the proxy setting when one is set and Node ignores it. */
function unreachableMessage(error: unknown, env: Readonly<Record<string, string | undefined>>): string {
  const reason =
    error instanceof Error && error.name === "TimeoutError"
      ? `no answer within ${DOCS_TIMEOUT_MS / 1000} s, tried ${DOCS_ATTEMPTS} times`
      : error instanceof Error
        ? error.message
        : String(error);
  const proxy = env.HTTPS_PROXY ?? env.https_proxy;
  const hint =
    proxy !== undefined && proxy !== "" && env.NODE_USE_ENV_PROXY !== "1"
      ? " HTTPS_PROXY is set, and Node's fetch uses it only with NODE_USE_ENV_PROXY=1."
      : "";
  return `Could not reach ${DOCS_ORIGIN} to read the docs (${reason}).${hint}`;
}
