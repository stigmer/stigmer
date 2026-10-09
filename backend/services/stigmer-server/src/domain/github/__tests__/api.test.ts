/**
 * Pins how the server's GitHub caller answers GitHub's failures, so the
 * console gets one meaning per case: an unreachable GitHub or a server
 * error is UNAVAILABLE, a rate limit or an abuse block is RESOURCE_EXHAUSTED
 * carrying GitHub's own message when it gave one, and a body that is not
 * JSON is UNAVAILABLE rather than a crash. And how it holds the login: a
 * redirect is never followed (the bearer header would travel with it), and
 * an answer past the read ceiling is refused, by its declared length before
 * any byte is read and otherwise once the ceiling is passed. A body that
 * refuses to be cancelled never hides the refusal.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { GITHUB_RESPONSE_CEILING_BYTES, newGitHubApi } from "../api.js";

function answering(response: () => Response | Promise<Response>): typeof fetch {
  return (async () => response()) as typeof fetch;
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("newGitHubApi", () => {
  it("answers UNAVAILABLE when GitHub cannot be reached", async () => {
    const api = newGitHubApi("t", (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    expect((await failureOf(api.getJson("/user", "the account"))).code).toBe(Code.Unavailable);
  });

  it("answers RESOURCE_EXHAUSTED for a rate limit, with GitHub's message when it gave one", async () => {
    const limited = await failureOf(
      newGitHubApi(
        "t",
        answering(() => new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403 })),
      ).getJson("/user/repos", "your repositories"),
    );
    expect(limited.code).toBe(Code.ResourceExhausted);
    expect(limited.rawMessage).toBe(
      "GitHub refused the request for your repositories (HTTP 403): API rate limit exceeded",
    );

    const bare = await failureOf(
      newGitHubApi("t", answering(() => new Response("slow down", { status: 429 }))).getJson(
        "/user/repos",
        "your repositories",
      ),
    );
    expect(bare.rawMessage).toBe("GitHub refused the request for your repositories (HTTP 429)");

    const unreadable = await failureOf(
      newGitHubApi(
        "t",
        answering(
          () =>
            ({
              status: 403,
              ok: false,
              headers: new Headers(),
              text: () => Promise.reject(new Error("connection reset")),
            }) as unknown as Response,
        ),
      ).getJson("/user/repos", "your repositories"),
    );
    expect(unreadable.rawMessage).toBe("GitHub refused the request for your repositories (HTTP 403)");
  });

  it("answers UNAVAILABLE for a server error and for a body that is not JSON", async () => {
    const down = await failureOf(
      newGitHubApi("t", answering(() => new Response("", { status: 502 }))).getJson("/user", "the account"),
    );
    expect(down.code).toBe(Code.Unavailable);

    const garbled = await failureOf(
      newGitHubApi("t", answering(() => new Response("<html>", { status: 200 }))).getJson(
        "/user",
        "the account",
      ),
    );
    expect(garbled.code).toBe(Code.Unavailable);
    expect(garbled.rawMessage).toBe("GitHub answered an unreadable body for the account");
  });

  it("never follows a redirect, so the login never leaves GitHub's API host", async () => {
    const calls: Array<{ url: string; redirect: RequestInit["redirect"] }> = [];
    const api = newGitHubApi("t", (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), redirect: init?.redirect });
      return new Response("", {
        status: 301,
        headers: { location: "https://collector.example/repos/acme/app" },
      });
    }) as typeof fetch);

    const moved = await failureOf(api.getJson("/repos/acme/app", "acme/app"));

    expect(calls).toEqual([{ url: "https://api.github.com/repos/acme/app", redirect: "manual" }]);
    expect(moved.code).toBe(Code.FailedPrecondition);
    expect(moved.rawMessage).toContain("GitHub redirected the request for acme/app (HTTP 301)");
  });

  it("refuses an answer declared larger than the ceiling before reading it", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 64) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const oversized = await failureOf(
      newGitHubApi(
        "t",
        answering(
          () =>
            new Response(body, {
              status: 200,
              headers: { "content-length": String(GITHUB_RESPONSE_CEILING_BYTES + 1) },
            }),
        ),
      ).getJson("/repos/acme/app/git/trees/main?recursive=1", "acme/app at main"),
    );
    expect(oversized.code).toBe(Code.FailedPrecondition);
    expect(oversized.rawMessage).toContain("GitHub's answer for acme/app at main is larger than");
    // At most the stream's own read-ahead: nothing was consumed.
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("keeps each refusal when the body cannot be cancelled", async () => {
    const stubborn = (chunks: number): ReadableStream<Uint8Array> => {
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= chunks) {
            controller.close();
            return;
          }
          sent += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          throw new Error("this body cannot be cancelled");
        },
      });
    };
    const refusalFor = (response: () => Response) =>
      failureOf(newGitHubApi("t", answering(response)).getJson("/repos/acme/app", "acme/app"));

    const moved = await refusalFor(
      () => new Response(stubborn(1), { status: 302, headers: { location: "https://elsewhere.example/" } }),
    );
    expect(moved.rawMessage).toContain("GitHub redirected the request for acme/app (HTTP 302)");

    const declared = await refusalFor(
      () =>
        new Response(stubborn(1), {
          status: 200,
          headers: { "content-length": String(GITHUB_RESPONSE_CEILING_BYTES + 1) },
        }),
    );
    expect(declared.rawMessage).toContain("is larger than");

    const streamed = await refusalFor(
      () => new Response(stubborn(GITHUB_RESPONSE_CEILING_BYTES / (1024 * 1024) + 4), { status: 200 }),
    );
    expect(streamed.rawMessage).toContain("is larger than");
  });

  it("stops reading an answer once it passes the ceiling", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    const length = GITHUB_RESPONSE_CEILING_BYTES + 8 * chunk.byteLength;
    let served = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (served >= length) {
          controller.close();
          return;
        }
        served += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const oversized = await failureOf(
      newGitHubApi("t", answering(() => new Response(body, { status: 200 }))).getJson(
        "/repos/acme/app/git/blobs/abc",
        "big.bin in acme/app at main",
      ),
    );
    expect(oversized.code).toBe(Code.FailedPrecondition);
    expect(oversized.rawMessage).toContain("is larger than");
    // The body is cut off just past the ceiling, never read to its end.
    expect(served).toBeLessThanOrEqual(GITHUB_RESPONSE_CEILING_BYTES + 2 * chunk.byteLength);
  });
});
