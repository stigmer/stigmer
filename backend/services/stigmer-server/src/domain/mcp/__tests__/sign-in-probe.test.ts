/**
 * Pins the shared sign-in probe both homes ask through: which entries are
 * the author's shape (an `http` server that says nothing about
 * authentication), what one question to a server answers (`oauth` on an
 * OAuth challenge, `none` on any other HTTP answer, `unreachable` on none
 * or on a fetch that throws), and what an OAuth answer writes into an
 * entry (`sign_in.oauth_only`, the Bearer header naming the login key, the
 * key in `env`), on a copy, never the entry it was handed.
 *
 * The fetch is a fake, so no test touches the network.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  StdioMcpServerSchema,
} from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";

import { createLogger } from "../../../boot/logger.js";
import { askSignIn, authorShapeUrl, completeSignIn } from "../sign-in-probe.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

/** A fetch answering every call with `answer`, recording the headers of each. */
function fakeFetch(answer: () => Promise<Response>): { readonly fetch: OutboundFetch; readonly headers: Headers[] } {
  const headers: Headers[] = [];
  return {
    headers,
    fetch: (_url, init) => {
      headers.push(new Headers(init?.headers));
      return answer();
    },
  };
}

const oauthChallenge = (): Promise<Response> =>
  Promise.resolve(
    new Response(null, {
      status: 401,
      headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"' },
    }),
  );

function httpEntry(name: string, headers: Record<string, string> = {}, env: string[] = []): McpServerEntry {
  return create(McpServerEntrySchema, {
    name,
    transport: { case: "http", value: create(HttpMcpServerSchema, { url: `https://${name}.vendor.test/mcp`, headers }) },
    env,
  });
}

describe("authorShapeUrl", () => {
  it("is the URL of an http server with no variables and no authentication in its headers", () => {
    expect(authorShapeUrl(httpEntry("docs", { "X-Trace": "on" }))).toBe("https://docs.vendor.test/mcp");
  });

  it.each([
    ["an Authorization header, in any case", httpEntry("docs", { authorization: "Bearer abc" })],
    ["a ${VAR} in a header", httpEntry("docs", { "X-Api-Key": "${DOCS_KEY}" })],
    ["a variable", httpEntry("docs", {}, ["DOCS_KEY"])],
    [
      "a stdio server",
      create(McpServerEntrySchema, { name: "local", transport: { case: "stdio", value: create(StdioMcpServerSchema, { command: "x" }) } }),
    ],
  ])("is undefined for %s", (_label, entry) => {
    expect(authorShapeUrl(entry)).toBeUndefined();
  });
});

describe("askSignIn", () => {
  const ask = (answer: () => Promise<Response>) => askSignIn("https://docs.vendor.test/mcp", { "X-Trace": "on" }, {
    outboundFetch: fakeFetch(answer).fetch,
    logger: silentLogger,
  });

  it("answers oauth on an OAuth challenge, sending the author's headers", async () => {
    const fake = fakeFetch(oauthChallenge);
    await expect(
      askSignIn("https://docs.vendor.test/mcp", { "X-Trace": "on" }, { outboundFetch: fake.fetch, logger: silentLogger }),
    ).resolves.toBe("oauth");
    expect(fake.headers[0]?.get("x-trace")).toBe("on");
  });

  it.each([
    ["a 2xx", () => Promise.resolve(new Response("{}", { status: 200 }))],
    ["a non-OAuth 401", () => Promise.resolve(new Response(null, { status: 401, headers: { "www-authenticate": 'Basic realm="x"' } }))],
    ["another status", () => Promise.resolve(new Response(null, { status: 500 }))],
  ])("answers none on %s", async (_label, answer) => {
    await expect(ask(answer)).resolves.toBe("none");
  });

  it("answers unreachable when the fetch fails", async () => {
    await expect(ask(() => Promise.reject(new TypeError("fetch failed")))).resolves.toBe("unreachable");
  });

  it("answers unreachable when the fetch throws before returning a promise", async () => {
    const throwing: OutboundFetch = () => {
      throw new Error("defective fetch");
    };
    await expect(
      askSignIn("https://docs.vendor.test/mcp", {}, { outboundFetch: throwing, logger: silentLogger }),
    ).resolves.toBe("unreachable");
  });
});

describe("completeSignIn", () => {
  it("adds the sign-in, the Bearer header and the variable to a copy", () => {
    const entry = httpEntry("docs", { "X-Trace": "on" });
    const done = completeSignIn(entry, "DOCS_ACCESS_TOKEN");
    expect(done.signIn?.oauthOnly).toBe(true);
    expect(done.env).toEqual(["DOCS_ACCESS_TOKEN"]);
    expect(done.transport.case === "http" ? done.transport.value.headers : {}).toEqual({
      "X-Trace": "on",
      Authorization: "Bearer ${DOCS_ACCESS_TOKEN}",
    });
    expect(entry.signIn).toBeUndefined();
    expect(entry.env).toEqual([]);
  });
});
