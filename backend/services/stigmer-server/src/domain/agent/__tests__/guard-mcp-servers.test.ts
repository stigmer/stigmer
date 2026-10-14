/**
 * Pins GuardMcpServers (domain/agent/guard-mcp-servers.ts), the step that
 * lets only an organization's admins point its runs at a new address. The
 * predicate flags a server that is new or whose URL or any header differs
 * from the stored one of its name, never an echo (headers compared
 * whatever their order) or a removal. The step asks the authorizer only
 * for such a write, exactly once, for `can_create_plugin` on the agent's
 * organization; a denial is PermissionDenied naming the servers and the
 * way out; a server-composed request (internal or in-process) passes
 * without a question. The chains that run it are pinned by the
 * agent-mcp-servers conformance suite on the enforcing lane.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentMcpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentMcpServer } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { mcpServerMutations, mcpServersAdminOnlyMessage, newGuardMcpServersStep } from "../guard-mcp-servers.js";

const MEMBER: CallerIdentity = { identityId: "ida_member", callerClass: "user", issuer: "stigmer", rawToken: "tok" };

function server(name: string, url = `https://${name}.example.com/mcp`, headers: Record<string, string> = {}): AgentMcpServer {
  return create(AgentMcpServerSchema, { name, url, headers });
}

/** An authorizer that records each question and answers `kind`. */
function answering(kind: "allow" | "deny", observed: AuthzCheck[]): Authorizer {
  return {
    authorize: (_caller, check) => {
      observed.push(check);
      return Promise.resolve(kind === "allow" ? { kind: "allow" } : { kind: "deny", reason: "" });
    },
  };
}

function contextOf(
  requested: AgentMcpServer[],
  stored: AgentMcpServer[] | undefined,
  caller: CallerIdentity = MEMBER,
): RequestContext<typeof AgentSchema> {
  const ctx = new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { name: "Helper", org: "acme" }, spec: { mcpServers: requested } }),
    caller,
    ApiResourceKind.agent,
  );
  if (stored !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, create(AgentSchema, { metadata: { name: "Helper", org: "acme" }, spec: { mcpServers: stored } }));
  }
  return ctx;
}

async function refusalOf(promise: Promise<void> | void): Promise<ConnectError> {
  const error = await Promise.resolve(promise).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("mcpServerMutations", () => {
  it("flags a new server and a changed URL or header, sorted, never an echo or a removal", () => {
    const stored = [
      server("kept", "https://kept.example.com/mcp", { "X-A": "1", "X-B": "2" }),
      server("moved"),
      server("rekeyed", "https://rekeyed.example.com/mcp", { "X-Key": "${OLD}" }),
      server("removed"),
    ];
    const requested = [
      server("kept", "https://kept.example.com/mcp", { "X-B": "2", "X-A": "1" }),
      server("moved", "https://elsewhere.example.com/mcp"),
      server("rekeyed", "https://rekeyed.example.com/mcp", { "X-Key": "${NEW}" }),
      server("added"),
    ];
    expect(mcpServerMutations(stored, requested)).toEqual(["added", "moved", "rekeyed"]);
  });

  it("flags a header added to, or dropped from, a stored server", () => {
    expect(mcpServerMutations([server("a")], [server("a", undefined, { "X-New": "1" })])).toEqual(["a"]);
    expect(mcpServerMutations([server("a", undefined, { "X-Old": "1" })], [server("a")])).toEqual(["a"]);
  });
});

describe("GuardMcpServers", () => {
  it("asks nothing for a write that echoes or removes servers", async () => {
    const observed: AuthzCheck[] = [];
    const step = newGuardMcpServersStep(answering("deny", observed));
    await step.execute(contextOf([server("a")], [server("a"), server("b")]));
    await step.execute(contextOf([], [server("a")]));
    await step.execute(contextOf([], undefined));
    expect(observed).toEqual([]);
  });

  it("refuses a member's new server with PermissionDenied, after one question of the organization", async () => {
    const observed: AuthzCheck[] = [];
    const error = await refusalOf(newGuardMcpServersStep(answering("deny", observed)).execute(contextOf([server("zendesk")], undefined)));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(mcpServersAdminOnlyMessage(["zendesk"]));
    expect(error.rawMessage).toBe(
      "only an organization's admins may add or change an agent's MCP servers (zendesk); ask an admin, or use a plugin an admin installed",
    );
    expect(observed).toEqual([
      { permission: IamPermission.can_create_plugin, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
    ]);
  });

  it("refuses a member's changed address, naming each server the write changes", async () => {
    const error = await refusalOf(
      newGuardMcpServersStep(answering("deny", [])).execute(
        contextOf([server("b", "https://other.example.com/mcp"), server("a", "https://other.example.com/mcp")], [server("a"), server("b")]),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(mcpServersAdminOnlyMessage(["a", "b"]));
  });

  it("lets an admin add and change servers", async () => {
    const observed: AuthzCheck[] = [];
    await newGuardMcpServersStep(answering("allow", observed)).execute(contextOf([server("a", "https://moved.example.com/mcp")], [server("a")]));
    expect(observed).toHaveLength(1);
  });

  it("passes a request the server composed, internal or in-process, without asking", async () => {
    const observed: AuthzCheck[] = [];
    const step = newGuardMcpServersStep(answering("deny", observed));
    await step.execute(contextOf([server("a")], undefined, { ...MEMBER, callerClass: "internal" }));
    await step.execute(contextOf([server("a")], undefined, { ...MEMBER, origin: "in-process" }));
    expect(observed).toEqual([]);
  });
});
