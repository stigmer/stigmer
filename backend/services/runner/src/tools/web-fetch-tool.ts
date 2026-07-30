/**
 * Native `web_fetch` tool — built-in URL retrieval for the deep-agent harness.
 *
 * Closes the harness parity gap of stigmer/stigmer#214: the Cursor harness
 * ships WebFetch as a CLI built-in, while native runs previously needed an
 * MCP server (seedpack `fetch`) for the same capability. Both tool names
 * classify to TOOL_KIND_FETCH, so rendering is identical across harnesses.
 *
 * Design constraints, in order:
 *
 * - Security: every URL — including every redirect hop — passes the URL
 *   guard (url-guard.ts). web_fetch is auto-approved, so the guard is the
 *   only boundary between "fetch a page" and the runner's network position.
 * - Model ergonomics: HTML is reduced to Markdown (turndown, with obvious
 *   chrome stripped), and `start_index`/`max_length` give the model
 *   deterministic pagination over large pages — the same surface the
 *   seedpack fetch MCP exposed, so existing agent instructions keep working.
 * - Budget discipline: the default window (20 000 chars) sits deliberately
 *   below the tool-truncation middleware's 30 000-char default, so the
 *   truncation layer never chops fetch output and the model's pagination
 *   arithmetic stays exact.
 *
 * Failures return a plain "Error: …" string instead of throwing: a fetch
 * miss is information the model should route around (try the .md export,
 * cite a different page), not an execution fault.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import TurndownService from "turndown";
import { validateFetchUrl, UrlGuardError, type GuardPosture } from "./url-guard.js";

/** Ceiling on response bytes read from the wire, before any conversion. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Per-request timeout; applied to each redirect hop independently. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Redirect chain limit — matches the common browser/curl default region. */
const MAX_REDIRECTS = 5;

/** Default pagination window; see file header for why it is below 30 000. */
const DEFAULT_MAX_LENGTH = 20_000;

/** Hard ceiling for a caller-supplied max_length. */
const MAX_MAX_LENGTH = 100_000;

const USER_AGENT = "Stigmer/1.0 (web_fetch; +https://stigmer.ai)";

export interface WebFetchToolOptions {
  /** URL guard posture — derive via resolveGuardPosture(config.mode). */
  readonly posture: GuardPosture;
}

export function createWebFetchTool(options: WebFetchToolOptions) {
  return tool(
    async (input: { url: string; max_length?: number; start_index?: number }) => {
      try {
        return await runFetch(input, options.posture);
      } catch (err) {
        if (err instanceof UrlGuardError) {
          return `Error: ${err.message}`;
        }
        if (err instanceof Error && err.name === "TimeoutError") {
          return `Error: Fetching ${input.url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`;
        }
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to fetch ${input.url}: ${message}`;
      }
    },
    {
      name: "web_fetch",
      description:
        "Fetch the contents of a URL over http(s). HTML pages are converted " +
        "to Markdown; plain text, Markdown, JSON, and other text formats are " +
        "returned as-is. Binary content is not supported.\n\n" +
        "Large pages are windowed: at most max_length characters are " +
        "returned per call (default 20000). If the result ends with a " +
        "truncation notice, call web_fetch again with the same url and the " +
        "start_index the notice gives you to continue reading.",
      schema: z.object({
        url: z.string().describe("The http(s) URL to fetch."),
        max_length: z
          .number()
          .int()
          .positive()
          .max(MAX_MAX_LENGTH)
          .optional()
          .describe(`Maximum characters to return (default ${DEFAULT_MAX_LENGTH}).`),
        start_index: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Character offset to start from, for paginating large pages (default 0)."),
      }),
    },
  );
}

async function runFetch(
  input: { url: string; max_length?: number; start_index?: number },
  posture: GuardPosture,
): Promise<string> {
  const maxLength = input.max_length ?? DEFAULT_MAX_LENGTH;
  const startIndex = input.start_index ?? 0;

  const { response, finalUrl } = await fetchFollowingRedirects(input.url, posture);

  if (!response.ok) {
    // Drain defensively; some agents (undici) keep the connection reserved otherwise.
    await response.body?.cancel().catch(() => undefined);
    return `Error: ${finalUrl} responded with HTTP ${response.status} ${response.statusText}.`;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!isTextual(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return (
      `Error: ${finalUrl} returned non-text content (${contentType || "unknown type"}). ` +
      "web_fetch only supports text formats."
    );
  }

  const { text, bytesTruncated } = await readBodyCapped(response, MAX_RESPONSE_BYTES);

  const content = isHtml(contentType) ? htmlToMarkdown(text) : text;

  return paginate(content, {
    url: finalUrl,
    startIndex,
    maxLength,
    bytesTruncated,
  });
}

/**
 * Fetch with `redirect: "manual"`, re-validating each hop against the URL
 * guard — automatic following would let a public host 302 the runner into
 * a private address, bypassing the pre-flight check entirely.
 */
async function fetchFollowingRedirects(
  rawUrl: string,
  posture: GuardPosture,
): Promise<{ response: Response; finalUrl: string }> {
  let url = await validateFetchUrl(rawUrl, posture);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html, text/markdown;q=0.9, text/plain;q=0.8, application/json;q=0.7, */*;q=0.5",
      },
    });

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: url.toString() };
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new Error(`redirect (HTTP ${response.status}) without a Location header`);
    }

    // Resolve relative redirects against the current hop, then re-guard.
    url = await validateFetchUrl(new URL(location, url).toString(), posture);
  }

  throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
}

/** Stream the body, stopping at the byte cap instead of buffering unbounded. */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytesTruncated: boolean }> {
  if (!response.body) {
    return { text: "", bytesTruncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let bytesTruncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
        bytesTruncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  }

  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder("utf-8").decode(merged), bytesTruncated };
}

function isHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function isTextual(contentType: string): boolean {
  if (contentType === "") return true; // no header — assume text, the cap bounds the damage
  return /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|javascript|x-yaml|yaml|toml))/i.test(
    contentType,
  );
}

/**
 * Reduce HTML to Markdown. Page chrome that never carries answerable
 * content (scripts, styles, navigation, embedded media shells) is removed
 * before conversion so the pagination window is spent on substance.
 */
function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.remove([
    "script", "style", "noscript", "iframe", "object", "embed",
    "nav", "aside", "footer", "form", "button", "select", "canvas",
  ]);

  const markdown = turndown.turndown(html);
  // Collapse the blank-line runs left behind by removed blocks.
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

/** Apply the start_index/max_length window and explain any truncation. */
function paginate(
  content: string,
  opts: { url: string; startIndex: number; maxLength: number; bytesTruncated: boolean },
): string {
  if (opts.startIndex >= content.length && content.length > 0) {
    return `Error: start_index ${opts.startIndex} is beyond the end of the content (${content.length} characters).`;
  }
  if (content.length === 0) {
    return `[${opts.url} returned an empty body]`;
  }

  const window = content.slice(opts.startIndex, opts.startIndex + opts.maxLength);
  const end = opts.startIndex + window.length;
  const notices: string[] = [];

  if (end < content.length) {
    notices.push(
      `[Content truncated at ${end} of ${content.length} characters. ` +
      `Call web_fetch again with start_index=${end} to continue.]`,
    );
  }
  if (opts.bytesTruncated) {
    notices.push(
      `[The response exceeded the ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB fetch limit and was cut off.]`,
    );
  }

  return notices.length > 0 ? `${window}\n\n${notices.join("\n")}` : window;
}
