/**
 * The GitHub REST reads the console's repository picker, search, tree and
 * file reader need, made server-side with a person's saved `github.com`
 * login, so no page ever holds the token.
 *
 * Each call carries the token as a bearer header, GitHub's JSON media type
 * and the broker's timeout. Failures map onto the wire once, here: 401 is
 * the saved login gone stale (FAILED_PRECONDITION, "reconnect GitHub"),
 * 404 a repository, ref or path the account cannot see (NOT_FOUND), 403 a
 * rate limit or a refusal (RESOURCE_EXHAUSTED with GitHub's own words), a
 * network failure UNAVAILABLE. Nothing returned carries the token.
 *
 * The token stays with api.github.com. A redirect is never followed
 * (`redirect: "manual"`): the bearer header would go with it, so a 3xx
 * (GitHub's answer for a renamed repository) is refused, asking for the
 * repository's current name. Every answer is read up to `GITHUB_RESPONSE_CEILING_BYTES`
 * and refused past it, by its declared length before any byte is read.
 * These calls hold a fixed host, never a URL a user wrote, so they take no
 * egress guard: the server's guarded fetch judges user-supplied addresses,
 * and its one-mebibyte body bound is below what a file read here needs.
 *
 * Proven by __tests__/github-queries.test.ts and __tests__/api.test.ts
 * against an injected fetch.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { failedPreconditionError, notFoundError, unavailableError } from "../../pipeline/errors.js";

export const GITHUB_API = "https://api.github.com";

/** The broker's single-round-trip bound (Go httpTimeout). */
export const HTTP_TIMEOUT_MS = 10_000;

/** One page of repositories, GitHub's maximum. */
export const REPOSITORIES_PER_PAGE = 100;

/** Above this a file is reported by size and never downloaded. */
export const FILE_CONTENT_CEILING_BYTES = 10 * 1024 * 1024;

/**
 * The most of any GitHub answer the server reads: a file at the content
 * ceiling, base64 in a JSON envelope (four bytes for every three, plus line
 * breaks), with room to spare; a recursive tree stays well inside it.
 */
export const GITHUB_RESPONSE_CEILING_BYTES = 16 * 1024 * 1024;

/** The most of an error body read for GitHub's own message. */
const ERROR_BODY_CEILING_BYTES = 64 * 1024;

/** An answer longer than the ceiling it was read under. */
export class ResponseTooLargeError extends Error {
  constructor(readonly ceilingBytes: number) {
    super(`the answer is larger than ${ceilingBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * A response's body as text, read up to `ceilingBytes`: a declared length
 * past it is refused before any byte is read, and a body that passes it is
 * cancelled there. Throws ResponseTooLargeError, or the stream's own error.
 */
export async function readBoundedText(response: Response, ceilingBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > ceilingBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(ceilingBytes);
  }
  if (response.body === null || response.body === undefined) {
    return response.text();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    read += value.byteLength;
    if (read > ceilingBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(ceilingBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const RECONNECT_GITHUB =
  "GitHub refused the saved login: reconnect GitHub to refresh it";

export interface GitHubRepositoryJson {
  readonly id?: number;
  readonly full_name?: string;
  readonly name?: string;
  readonly owner?: { readonly login?: string; readonly type?: string };
  readonly html_url?: string;
  readonly clone_url?: string;
  readonly default_branch?: string;
  readonly private?: boolean;
  readonly updated_at?: string;
}

/** A GitHub API caller bound to one token. */
export interface GitHubApi {
  getJson<T>(path: string, what: string): Promise<{ body: T; link: string }>;
}

export function newGitHubApi(token: string, fetchImpl: typeof fetch): GitHubApi {
  return {
    async getJson<T>(path: string, what: string): Promise<{ body: T; link: string }> {
      let response: Response;
      try {
        response = await fetchImpl(`${GITHUB_API}${path}`, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch {
        throw unavailableError("failed to reach GitHub");
      }
      if (response.status === 401) {
        throw failedPreconditionError(RECONNECT_GITHUB);
      }
      if (response.status === 404) {
        throw notFoundError("GitHub", what);
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw failedPreconditionError(
          `GitHub redirected the request for ${what} (HTTP ${response.status}); the server does not follow ` +
            "a redirect with your login. If the repository was renamed or moved, use its current name",
        );
      }
      if (response.status === 403 || response.status === 429) {
        const detail = await readBoundedText(response, ERROR_BODY_CEILING_BYTES).catch(() => "");
        throw new ConnectError(
          `GitHub refused the request for ${what} (HTTP ${response.status})${messageOf(detail)}`,
          Code.ResourceExhausted,
        );
      }
      if (!response.ok) {
        throw unavailableError(`GitHub answered HTTP ${response.status} for ${what}`);
      }
      let body: T;
      try {
        body = JSON.parse(await readBoundedText(response, GITHUB_RESPONSE_CEILING_BYTES)) as T;
      } catch (error) {
        if (error instanceof ResponseTooLargeError) {
          throw failedPreconditionError(
            `GitHub's answer for ${what} is larger than the ${error.ceilingBytes / (1024 * 1024)} MiB the server reads`,
          );
        }
        throw unavailableError(`GitHub answered an unreadable body for ${what}`);
      }
      return { body, link: response.headers.get("link") ?? "" };
    },
  };
}

/** GitHub's own message from an error body, as a suffix; empty when there is none. */
function messageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message !== ""
      ? `: ${parsed.message}`
      : "";
  } catch {
    return "";
  }
}

/** Whether a Link header names a next page. */
export function hasNextPage(link: string): boolean {
  return /<[^>]*>;\s*rel="next"/.test(link);
}

/** A repo-relative path with each segment escaped and its slashes kept. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Decodes GitHub's base64 content, which wraps at 60 columns. */
export function decodeBase64(content: string): Uint8Array {
  return new Uint8Array(Buffer.from(content.replace(/\s/g, ""), "base64"));
}
