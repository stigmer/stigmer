/**
 * Pins the composition's client of the OSS grant path: each method reaches
 * the GrantCommandController RPC of the same name over the in-process
 * transport with its input unchanged; no caller header rides the call, so
 * the OSS interceptor mints the `internal` class the three system RPCs
 * admit; the transport is resolved lazily and a call before it is wired is
 * a loud INTERNAL, never a TypeError; a refusal from the controller arrives
 * as a FRESH ConnectError carrying the code and copy (a received error
 * object would drag the inner response's transport metadata through the
 * outer serving handler). The structural lane refuses a team as principal
 * before any RPC, because a grant to a team must meet the team grant gate
 * on Grant.create, while a team as resource passes through.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";

import { GrantCommandController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/command_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { IN_PROCESS_CALLER_HEADER } from "@stigmer/server";

import type { TransportRef } from "../../../rpc/transport-ref.js";
import { newGrantPathClient } from "../grant-path-client.js";

const GRANT = create(GrantSpecSchema, {
  principal: create(ApiResourceRefSchema, {
    kind: "identity_account",
    id: "ida_alice",
  }),
  relation: "member",
  resource: create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
});

interface Received {
  readonly calls: Array<{
    rpc: string;
    input: unknown;
    callerHeader: string | null;
  }>;
}

/** A controller that records what reached it and answers a stand-in row. */
function recordingRoutes(received: Received, refuse?: ConnectError) {
  return (router: ConnectRouter): void => {
    const record = (rpc: string, input: unknown, headers: Headers) => {
      received.calls.push({
        rpc,
        input,
        callerHeader: headers.get(IN_PROCESS_CALLER_HEADER),
      });
      if (refuse !== undefined) {
        throw refuse;
      }
    };
    const row = create(GrantSchema, { metadata: { id: "grt_answer" } });
    router.service(GrantCommandController, {
      create: (input, ctx) => {
        record("create", input, ctx.requestHeader);
        return row;
      },
      delete: (input, ctx) => {
        record("delete", input, ctx.requestHeader);
        return row;
      },
      bootstrapGrant: (input, ctx) => {
        record("bootstrapGrant", input, ctx.requestHeader);
        return row;
      },
      cleanupResourceGrants: (input, ctx) => {
        record("cleanupResourceGrants", input, ctx.requestHeader);
        return {};
      },
      revokeOrgAccess: (input, ctx) => {
        record("revokeOrgAccess", input, ctx.requestHeader);
        return {};
      },
      bootstrapRevokeOrgAccess: (input, ctx) => {
        record("bootstrapRevokeOrgAccess", input, ctx.requestHeader);
        return {};
      },
    });
  };
}

function wired(refuse?: ConnectError) {
  const received: Received = { calls: [] };
  const transportRef: TransportRef = {
    transport: createRouterTransport(recordingRoutes(received, refuse)),
  };
  return { received, client: newGrantPathClient(transportRef) };
}

describe("each method is the RPC of the same name, input unchanged, no caller header", () => {
  it("bootstrapGrant, create and delete carry the spec", async () => {
    const { received, client } = wired();
    expect((await client.bootstrapGrant(GRANT)).metadata?.id).toBe(
      "grt_answer",
    );
    expect((await client.create(GRANT)).metadata?.id).toBe("grt_answer");
    expect((await client.delete(GRANT)).metadata?.id).toBe("grt_answer");
    expect(received.calls.map((c) => c.rpc)).toEqual([
      "bootstrapGrant",
      "create",
      "delete",
    ]);
    for (const call of received.calls) {
      expect(call.input).toMatchObject({
        relation: "member",
        principal: { kind: "identity_account", id: "ida_alice" },
        resource: { kind: "organization", id: "acme" },
      });
      expect(
        call.callerHeader,
        "no propagated caller: the interceptor mints internal",
      ).toBeNull();
    }
  });

  it("cleanupResourceGrants carries the ref; bootstrapRevokeOrgAccess the account and organization ids", async () => {
    const { received, client } = wired();
    await client.cleanupResourceGrants(
      create(ApiResourceRefSchema, { kind: "oauth_app", id: "oap_1" }),
    );
    await client.bootstrapRevokeOrgAccess("ida_alice", "acme");
    expect(received.calls).toMatchObject([
      {
        rpc: "cleanupResourceGrants",
        input: { kind: "oauth_app", id: "oap_1" },
        callerHeader: null,
      },
      {
        rpc: "bootstrapRevokeOrgAccess",
        input: { identityAccountId: "ida_alice", org: "acme" },
        callerHeader: null,
      },
    ]);
  });

  it("never reaches the user-facing revokeOrgAccess lane — the composition acts as itself", async () => {
    const { received, client } = wired();
    await client.bootstrapRevokeOrgAccess("ida_alice", "acme");
    expect(received.calls.map((c) => c.rpc)).not.toContain("revokeOrgAccess");
  });
});

describe("the structural lane and teams", () => {
  it("refuses a team as principal before any RPC, and passes a team as resource through", async () => {
    const { received, client } = wired();
    const toTeam = create(GrantSpecSchema, {
      principal: create(ApiResourceRefSchema, { kind: "team", id: "tm_1" }),
      relation: "viewer",
      resource: create(ApiResourceRefSchema, { kind: "agent", id: "agt_1" }),
    });
    const refusal = await client.bootstrapGrant(toTeam).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(ConnectError);
    expect(refusal).toMatchObject({
      code: Code.Internal,
      rawMessage: "a grant to a team is made through Grant.create, never the structural lane",
    });
    expect(received.calls, "nothing reached the controller").toEqual([]);

    const teamLink = create(GrantSpecSchema, {
      principal: create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
      relation: "organization",
      resource: create(ApiResourceRefSchema, { kind: "team", id: "tm_1" }),
    });
    await client.bootstrapGrant(teamLink);
    expect(received.calls.map((c) => c.rpc)).toEqual(["bootstrapGrant"]);
  });
});

describe("the transport seam", () => {
  it("a call before the in-process transport is wired is a loud INTERNAL with a fixed sentence", async () => {
    const client = newGrantPathClient({});
    await expect(client.bootstrapGrant(GRANT)).rejects.toMatchObject({
      code: Code.Internal,
      rawMessage:
        "grant path used before the in-process transport was wired",
    });
  });

  it("a controller refusal arrives as a FRESH ConnectError with the same code and copy", async () => {
    const refusal = new ConnectError(
      "Role 'guest' is not grantable on resource kind 'organization'",
      Code.InvalidArgument,
    );
    const { client } = wired(refusal);
    let caught: unknown;
    try {
      await client.create(GRANT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConnectError);
    expect(caught).not.toBe(refusal);
    expect((caught as ConnectError).code).toBe(Code.InvalidArgument);
    expect((caught as ConnectError).rawMessage).toBe(refusal.rawMessage);
    expect(
      [...(caught as ConnectError).metadata.keys()],
      "no inner response metadata rides out",
    ).toEqual([]);
  });
});
