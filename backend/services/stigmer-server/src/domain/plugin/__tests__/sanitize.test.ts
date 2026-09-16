/**
 * Pins the sanitiser, the one place plugin-provided metadata is judged
 * before it rides the in-process lane: a `stigmer.ai/*` label in an
 * overlay is refused INVALID_ARGUMENT naming the document and the keys
 * under a denying authorizer and passes under an allowing one (the
 * open-source posture), the operator check is consulted lazily and only
 * for the platform capability, a preset id and a name that describes
 * another resource are refused as INVALID_ARGUMENT, and clean documents
 * pass without touching the authorizer.
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ParsedOverlays } from "../overlay/documents.js";
import { sanitizeOverlays } from "../overlay/sanitize.js";

const USER: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "stigmer",
  rawToken: "tok",
};

function denying(observed?: AuthzCheck[]): Authorizer {
  return {
    authorize: (_caller, check) => {
      observed?.push(check);
      return Promise.resolve({ kind: "deny", reason: "" });
    },
  };
}
function allowing(observed?: AuthzCheck[]): Authorizer {
  return {
    authorize: (_caller, check) => {
      observed?.push(check);
      return Promise.resolve({ kind: "allow" });
    },
  };
}

function overlays(parts: Partial<ParsedOverlays>): ParsedOverlays {
  return { workflows: [], mcpServers: [], ...parts };
}

function agentOverlay(metadata: {
  name?: string;
  slug?: string;
  id?: string;
  labels?: Record<string, string>;
}) {
  return {
    path: "ai.stigmer/agent.yaml",
    resource: create(AgentSchema, { metadata: { org: "acme", ...metadata } }),
  };
}

async function failure(promise: Promise<void>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

describe("sanitizeOverlays", () => {
  it("refuses a reserved label under a denying authorizer, naming the document and the keys", async () => {
    const error = await failure(
      sanitizeOverlays(
        overlays({
          agent: agentOverlay({
            labels: { "stigmer.ai/default-agent": "true", team: "x" },
          }),
        }),
        { pluginName: "thermos" },
        denying(),
        USER,
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toContain(
      "ai.stigmer/agent.yaml: stigmer.ai/default-agent",
    );
    expect(error.rawMessage).toContain(
      "Remove them from the plugin's ai.stigmer/ documents.",
    );
  });

  it("passes a reserved label under an allowing authorizer, consulting exactly the platform capability", async () => {
    const observed: AuthzCheck[] = [];
    await sanitizeOverlays(
      overlays({
        agent: agentOverlay({ labels: { "stigmer.ai/default-agent": "true" } }),
      }),
      { pluginName: "thermos" },
      allowing(observed),
      USER,
    );
    expect(observed).toEqual([
      {
        permission: IamPermission.can_write_reserved_labels,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ]);
  });

  it("never consults the authorizer for documents without reserved keys", async () => {
    const observed: AuthzCheck[] = [];
    await sanitizeOverlays(
      overlays({
        agent: agentOverlay({ name: "thermos", labels: { team: "x" } }),
        mcpServers: [
          {
            path: "ai.stigmer/mcp-servers/github.yaml",
            server: "github",
            resource: create(McpServerSchema, { metadata: { name: "github" } }),
          },
        ],
      }),
      { pluginName: "thermos" },
      denying(observed),
      USER,
    );
    expect(observed).toEqual([]);
  });

  it("refuses a preset metadata.id", async () => {
    const error = await failure(
      sanitizeOverlays(
        overlays({ agent: agentOverlay({ id: "agt_forged" }) }),
        { pluginName: "thermos" },
        denying(),
        USER,
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "overlay document 'ai.stigmer/agent.yaml' sets metadata.id; a plugin's resources take their ids from the server",
    );
  });

  it("refuses an overlay whose name describes another resource", async () => {
    const error = await failure(
      sanitizeOverlays(
        overlays({
          mcpServers: [
            {
              path: "ai.stigmer/mcp-servers/github.yaml",
              server: "github",
              resource: create(McpServerSchema, {
                metadata: { name: "gitlab" },
              }),
            },
          ],
        }),
        { pluginName: "thermos" },
        denying(),
        USER,
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toContain("names 'gitlab' but describes 'github'");
  });
});
