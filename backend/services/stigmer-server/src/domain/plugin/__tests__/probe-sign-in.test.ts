/**
 * Pins probeSignIns, install's one question to a plugin's servers: only an
 * `http` entry that says nothing about authentication (no variables, no
 * `Authorization` header in any case, no `${VAR}` in a header) is asked,
 * once, with the author's literal headers; an OAuth challenge completes a
 * copy of the entry with `sign_in.oauth_only`, the
 * `Authorization: Bearer ${<SERVER>_ACCESS_TOKEN}` header and the variable,
 * and declares the variable as a required secret without overwriting a
 * declaration the plugin already made; every other answer (a 2xx, a
 * non-OAuth 401, another status, no answer) leaves the entry as read; a
 * re-push of the installed digest reuses the stored entries and asks
 * nothing. Also pins the variable's name rule.
 *
 * The fetch is a fake recording each call, so no test touches the network.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  McpServerSignInSchema,
  PluginStatusSchema,
  StdioMcpServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import { createLogger } from "../../../boot/logger.js";
import { accessTokenVariable, probeSignIns } from "../probe-sign-in.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const DIGEST = "a".repeat(64);

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
}

/** A fetch answering every call with `answer`, recording each call. */
function recordingFetch(answer: () => Promise<Response>): {
  readonly fetch: OutboundFetch;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
      });
      return answer();
    },
  };
}

const oauthChallenge = (): Promise<Response> =>
  Promise.resolve(
    new Response(null, {
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"',
      },
    }),
  );

function httpEntry(
  name: string,
  url: string,
  headers: Record<string, string> = {},
  env: string[] = [],
): McpServerEntry {
  return create(McpServerEntrySchema, {
    name,
    env,
    transport: {
      case: "http",
      value: create(HttpMcpServerSchema, { url, headers }),
    },
  });
}

async function probeOne(
  entry: McpServerEntry,
  answer: () => Promise<Response>,
) {
  const recorder = recordingFetch(answer);
  const result = await probeSignIns(
    { outboundFetch: recorder.fetch, logger: silentLogger },
    { mcpServers: [entry], env: {} },
    DIGEST,
    undefined,
  );
  return { result, calls: recorder.calls };
}

describe("probeSignIns — an OAuth challenge", () => {
  it("completes the entry with oauth_only, the Bearer header and the variable, and declares it as a required secret", async () => {
    const entry = httpEntry("linear", "https://mcp.linear.test/mcp", {
      "X-Client": "stigmer",
    });
    const { result, calls } = await probeOne(entry, oauthChallenge);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://mcp.linear.test/mcp");
    expect(calls[0]?.method).toBe("POST");
    // The author's literal headers ride the handshake.
    expect(calls[0]?.headers.get("x-client")).toBe("stigmer");

    const completed = result.mcpServers[0]!;
    expect(completed.signIn?.oauthOnly).toBe(true);
    expect(completed.env).toEqual(["LINEAR_ACCESS_TOKEN"]);
    expect(completed.transport.case).toBe("http");
    if (completed.transport.case === "http") {
      expect(completed.transport.value.headers).toEqual({
        "X-Client": "stigmer",
        Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}",
      });
    }
    expect(result.env["LINEAR_ACCESS_TOKEN"]).toMatchObject({
      isSecret: true,
      optional: false,
      description:
        "OAuth access token for the 'linear' MCP server; Sign in fills it",
    });
    // The planned entry is copied, never changed in place.
    expect(entry.signIn).toBeUndefined();
    expect(entry.env).toEqual([]);
  });

  it("keeps a declaration the plugin already made for the variable", async () => {
    const recorder = recordingFetch(oauthChallenge);
    const declared = create(EnvVarDeclarationSchema, {
      isSecret: true,
      optional: true,
      description: "mine",
    });
    const result = await probeSignIns(
      { outboundFetch: recorder.fetch, logger: silentLogger },
      {
        mcpServers: [httpEntry("linear", "https://mcp.linear.test/mcp")],
        env: { LINEAR_ACCESS_TOKEN: declared },
      },
      DIGEST,
      undefined,
    );
    expect(result.env["LINEAR_ACCESS_TOKEN"]).toMatchObject({
      optional: true,
      description: "mine",
    });
  });
});

describe("probeSignIns — every other answer leaves the entry as read", () => {
  const answers: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
    ["a 2xx", () => Promise.resolve(new Response("{}", { status: 200 }))],
    [
      "a 401 that is not OAuth",
      () =>
        Promise.resolve(
          new Response(null, {
            status: 401,
            headers: { "www-authenticate": 'Bearer error="invalid_token"' },
          }),
        ),
    ],
    [
      "another status",
      () => Promise.resolve(new Response(null, { status: 503 })),
    ],
    ["no answer", () => Promise.reject(new TypeError("fetch failed"))],
  ];
  for (const [label, answer] of answers) {
    it(label, async () => {
      const entry = httpEntry("docs", "https://docs.vendor.test/mcp");
      const { result, calls } = await probeOne(entry, answer);
      expect(calls).toHaveLength(1);
      expect(result.mcpServers[0]).toBe(entry);
      expect(result.env).toEqual({});
    });
  }
});

describe("probeSignIns — what is never asked", () => {
  const authorSpoke: ReadonlyArray<readonly [string, McpServerEntry]> = [
    [
      "an entry that reads a variable",
      httpEntry("a", "https://a.test/mcp", {}, ["A_KEY"]),
    ],
    [
      "an Authorization header, in any case",
      httpEntry("b", "https://b.test/mcp", { authorization: "Basic xyz" }),
    ],
    [
      "a variable in any header",
      httpEntry("c", "https://c.test/mcp", { "X-Api-Key": "${C_KEY}" }),
    ],
    [
      "a local program",
      create(McpServerEntrySchema, {
        name: "d",
        transport: {
          case: "stdio",
          value: create(StdioMcpServerSchema, { command: "npx" }),
        },
      }),
    ],
  ];
  for (const [label, entry] of authorSpoke) {
    it(label, async () => {
      const { result, calls } = await probeOne(entry, oauthChallenge);
      expect(calls).toEqual([]);
      expect(result.mcpServers[0]).toBe(entry);
    });
  }

  it("reuses the installed entries and variables for the same digest, asking nothing", async () => {
    const stored = httpEntry(
      "linear",
      "https://mcp.linear.test/mcp",
      { Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}" },
      ["LINEAR_ACCESS_TOKEN"],
    );
    stored.signIn = create(McpServerSignInSchema, { oauthOnly: true });
    const installed = create(PluginStatusSchema, {
      digest: DIGEST,
      mcpServers: [stored],
      env: {
        LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
          isSecret: true,
        }),
      },
    });
    const recorder = recordingFetch(oauthChallenge);
    const result = await probeSignIns(
      { outboundFetch: recorder.fetch, logger: silentLogger },
      {
        mcpServers: [httpEntry("linear", "https://mcp.linear.test/mcp")],
        env: {},
      },
      DIGEST,
      installed,
    );
    expect(recorder.calls).toEqual([]);
    expect(result.mcpServers).toEqual([stored]);
    expect(Object.keys(result.env)).toEqual(["LINEAR_ACCESS_TOKEN"]);
  });

  it("asks again for a different digest, and when the installed plugin records none", async () => {
    for (const digest of ["b".repeat(64), ""]) {
      const installed = create(PluginStatusSchema, { digest, mcpServers: [] });
      const recorder = recordingFetch(oauthChallenge);
      const result = await probeSignIns(
        { outboundFetch: recorder.fetch, logger: silentLogger },
        {
          mcpServers: [httpEntry("linear", "https://mcp.linear.test/mcp")],
          env: {},
        },
        digest === "" ? "" : DIGEST,
        installed,
      );
      expect(recorder.calls).toHaveLength(1);
      expect(result.mcpServers[0]?.signIn?.oauthOnly).toBe(true);
    }
  });
});

describe("accessTokenVariable", () => {
  it("upper-cases the server's name, every non-alphanumeric run one underscore, trimmed", () => {
    expect(accessTokenVariable("linear")).toBe("LINEAR_ACCESS_TOKEN");
    expect(accessTokenVariable("my-server.v2")).toBe(
      "MY_SERVER_V2_ACCESS_TOKEN",
    );
    expect(accessTokenVariable("-edge-")).toBe("EDGE_ACCESS_TOKEN");
    expect(accessTokenVariable("--")).toBe("MCP_ACCESS_TOKEN");
  });
});
