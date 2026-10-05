/**
 * Pins the deleting rule's predicate and its request seat (../lifecycle.ts)
 * without a server: the composed suites prove the seats on the wire.
 *
 * What it pins:
 *   - `isDeleting` reads once per request scope and organization, reads
 *     every time without a scope, never for an empty id, and does not
 *     remember a failed read;
 *   - `deletingIds` answers the table's organizations;
 *   - the interceptor refuses a request naming a deleting organization with
 *     the Authorize step's not-found copy, in any field the contract spells
 *     as an organization, passes one that names a live one, and reads
 *     nothing for a request that names none.
 */
import { create } from "@bufbuild/protobuf";
import type { UnaryRequest, UnaryResponse } from "@connectrpc/connect";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentIdSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationIdSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";

import type { OrganizationDeletion } from "../../../store/interface.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  createDeletingOrganizationInterceptor,
  newOrganizationLifecycle,
} from "../lifecycle.js";

const DELETING = "org_01kdeletingdeletingdeleting";
const LIVE = "org_01kliveliveliveliveliveliv0";

function deletionTable(deleting: ReadonlyArray<string>) {
  const reads: string[] = [];
  let fail = false;
  return {
    reads,
    failNext: () => {
      fail = true;
    },
    store: {
      async isDeleting(org: string) {
        reads.push(org);
        if (fail) {
          fail = false;
          throw new Error("store down");
        }
        return deleting.includes(org);
      },
      async list(): Promise<OrganizationDeletion[]> {
        return deleting.map((org) => ({
          org,
          phase: "accepted",
          markedAt: "",
          acceptedAt: "",
          heartbeatAt: "",
          stage: "",
          lastError: "",
        }));
      },
    },
  };
}

describe("the deleting predicate", () => {
  it("reads once per scope and organization, and every time without a scope", async () => {
    const table = deletionTable([DELETING]);
    const lifecycle = newOrganizationLifecycle(table.store);
    const scope = {};
    expect(await lifecycle.isDeleting(scope, DELETING)).toBe(true);
    expect(await lifecycle.isDeleting(scope, DELETING)).toBe(true);
    expect(await lifecycle.isDeleting(scope, LIVE)).toBe(false);
    expect(await lifecycle.isDeleting({}, DELETING)).toBe(true);
    expect(await lifecycle.isDeleting(undefined, LIVE)).toBe(false);
    expect(await lifecycle.isDeleting(undefined, LIVE)).toBe(false);
    expect(await lifecycle.isDeleting(scope, "")).toBe(false);
    expect(table.reads).toEqual([DELETING, LIVE, DELETING, LIVE, LIVE]);
    expect([...(await lifecycle.deletingIds())]).toEqual([DELETING]);
  });

  it("does not remember a failed read", async () => {
    const table = deletionTable([DELETING]);
    const lifecycle = newOrganizationLifecycle(table.store);
    const scope = {};
    table.failNext();
    await expect(lifecycle.isDeleting(scope, DELETING)).rejects.toThrow("store down");
    expect(await lifecycle.isDeleting(scope, DELETING)).toBe(true);
  });
});

describe("the deleting interceptor", () => {
  const next = async (
    request: UnaryRequest,
  ): Promise<UnaryResponse> =>
    ({
      stream: false,
      service: request.service,
      method: request.method,
      header: new Headers(),
      trailer: new Headers(),
      message: request.message,
    }) as UnaryResponse;

  function request(
    method: UnaryRequest["method"],
    message: UnaryRequest["message"],
  ): UnaryRequest {
    const contextValues = createContextValues();
    contextValues.set(callerIdentityKey, testCallerIdentity());
    return {
      stream: false,
      service: method.parent,
      method,
      requestMethod: "POST",
      url: "http://in-process/",
      signal: new AbortController().signal,
      header: new Headers(),
      contextValues,
      message,
    } as UnaryRequest;
  }

  it("refuses a request naming a deleting organization with the Authorize step's not-found copy", async () => {
    const table = deletionTable([DELETING]);
    const intercept = createDeletingOrganizationInterceptor(
      newOrganizationLifecycle(table.store),
    )(next as never);
    const byAnnotation = request(
      OrganizationQueryController.method.get,
      create(OrganizationIdSchema, { value: DELETING }),
    );
    const refusal = await intercept(byAnnotation).catch((error: unknown) =>
      ConnectError.from(error),
    );
    expect(refusal).toBeInstanceOf(ConnectError);
    expect((refusal as ConnectError).code).toBe(Code.NotFound);
    expect((refusal as ConnectError).rawMessage).toBe(
      `Organization not found: ${DELETING}`,
    );

    const byMetadata = request(
      AgentCommandController.method.create,
      create(AgentSchema, { metadata: { org: DELETING, name: "a" } }),
    );
    await expect(intercept(byMetadata)).rejects.toThrow(
      `Organization not found: ${DELETING}`,
    );

    const live = request(
      AgentCommandController.method.create,
      create(AgentSchema, { metadata: { org: LIVE, name: "a" } }),
    );
    await expect(intercept(live)).resolves.toBeDefined();
  });

  it("reads nothing for a request that names no organization", async () => {
    const table = deletionTable([DELETING]);
    const intercept = createDeletingOrganizationInterceptor(
      newOrganizationLifecycle(table.store),
    )(next as never);
    await intercept(
      request(
        AgentCommandController.method.delete,
        create(AgentIdSchema, { value: "agt_1" }),
      ),
    );
    expect(table.reads).toEqual([]);
  });
});
