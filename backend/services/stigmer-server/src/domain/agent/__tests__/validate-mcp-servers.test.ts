/**
 * Pins ValidateMcpServers (domain/agent/steps.ts), the step that holds an
 * agent's own MCP servers to what the proto's per-field rules cannot say:
 * a name used once, never the platform's, one starting "stigmer" or
 * "plugin"; an
 * address the plugin reader accepts (https, or http on a loopback host; no
 * credentials or fragment) that names no variable; a header named once in
 * any letter case; and a `${...}` in a header value only in the runner's
 * `${NAME}` grammar, so a plugin's `${user_config.x}` or
 * `${CLAUDE_PLUGIN_ROOT}` is refused rather than sent as text. Every
 * refusal is INVALID_ARGUMENT naming the server. A valid list, with
 * run values and platform variables in its headers, passes unchanged.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newValidateMcpServersStep } from "../steps.js";

interface ServerInit {
  name: string;
  url?: string;
  headers?: Record<string, string>;
}

function contextWith(servers: ServerInit[]): RequestContext<typeof AgentSchema> {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, {
      metadata: { name: "Helper", org: "acme" },
      spec: {
        instructions: "help the user with their tasks",
        mcpServers: servers.map((server) => ({
          name: server.name,
          url: server.url ?? `https://${server.name}.example.com/mcp`,
          headers: server.headers ?? {},
        })),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
}

function refusalOf(servers: ServerInit[]): ConnectError {
  try {
    newValidateMcpServersStep().execute(contextWith(servers));
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

describe("ValidateMcpServers", () => {
  it("passes a valid list with run values and platform variables in its headers", () => {
    const ctx = contextWith([
      { name: "zendesk", url: "https://acme-co.zendesk.com/mcp", headers: { "X-Api-Key": "${ZENDESK_KEY}" } },
      { name: "local", url: "http://127.0.0.1:8080/mcp", headers: { "X-Caller": "${STIGMER_CALLER_IDENTITY_VALUE}", "X-Trace": "on" } },
      { name: "loopback", url: "http://localhost:9000/mcp" },
    ]);
    newValidateMcpServersStep().execute(ctx);
    expect(ctx.newState.spec?.mcpServers.map((server) => server.name)).toEqual(["zendesk", "local", "loopback"]);
  });

  it("refuses a name used twice", () => {
    expect(refusalOf([{ name: "crm" }, { name: "crm", url: "https://other.example.com/mcp" }]).rawMessage).toContain(
      "server 'crm' is listed more than once",
    );
  });

  it.each(["stigmer-memory", "stigmer-channels", "stigmer-conversation", "stigmer", "stigmerx", "plugin"])(
    "refuses the reserved name %s",
    (name) => {
      expect(refusalOf([{ name }]).rawMessage).toContain(`server '${name}' takes a reserved name`);
    },
  );

  it.each([
    "http://mcp.example.com/mcp",
    "ftp://mcp.example.com/mcp",
    "https://user:pass@mcp.example.com/mcp",
    "https://mcp.example.com/mcp#frag",
    "not a url",
  ])("refuses the address %s", (url) => {
    expect(refusalOf([{ name: "crm", url }]).rawMessage).toContain("server 'crm' has an address that is not https");
  });

  it("refuses a variable in the address", () => {
    expect(refusalOf([{ name: "crm", url: "https://${TENANT}.example.com/mcp" }]).rawMessage).toContain(
      "server 'crm' names a variable in its url",
    );
  });

  it("refuses a header named twice in any letter case", () => {
    expect(refusalOf([{ name: "crm", headers: { "X-Key": "a", "x-key": "b" } }]).rawMessage).toMatch(
      /server 'crm' names header '(X-Key|x-key)' more than once/,
    );
  });

  it.each(["${CLAUDE_PLUGIN_ROOT}/x", "${PLUGIN_ROOT}", "${CURSOR_PLUGIN_ROOT}"])("refuses a header value naming a plugin's directory: %s", (value) => {
    expect(refusalOf([{ name: "crm", headers: { "X-Root": value } }]).rawMessage).toContain(
      "server 'crm' header 'X-Root' reads ${",
    );
  });

  it.each(["Bearer ${user_config.token}", "${1BAD}", "prefix ${", "${OK} and ${not-ok}"])(
    "refuses a header value whose ${...} is not a run value: %s",
    (value) => {
      expect(refusalOf([{ name: "crm", headers: { Authorization: value } }]).rawMessage).toContain(
        "server 'crm' header 'Authorization' holds a ${...} that is not a run value",
      );
    },
  );
});
