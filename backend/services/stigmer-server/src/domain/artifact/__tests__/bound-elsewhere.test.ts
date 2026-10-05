/**
 * Pins artifact create's binding check (controller.ts `createArtifact`): a
 * credential bound to one organization is refused, with the binding's
 * sentence, when the source execution belongs to another, and nothing is
 * uploaded or saved; an execution in its own organization is filed as
 * before. The registered handler runs on an in-process router whose
 * verifier stamps a bound caller; the store and the blob storage are
 * recording fakes.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../../authorization/credential-binding.js";
import { createLogger } from "../../../boot/logger.js";
import type { IdentityVerifier } from "../../../extensions/identity.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerArtifactServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A verifier that admits every bearer as Alice, bound to `org_a`. */
const boundVerifier: IdentityVerifier = {
  name: "bound-test",
  verify: async (token) => ({
    identityId: "ida_alice",
    callerClass: "user",
    issuer: "",
    rawToken: token,
    boundOrg: "org_a",
  }),
};

function harness() {
  const uploads: string[] = [];
  const saved: string[] = [];
  const executions: Record<string, string> = {
    aex_in_a: "org_a",
    aex_in_b: "org_b",
  };
  const store = {
    getResource<Desc extends DescMessage>(
      _kind: ApiResourceKind,
      id: string,
      schema: Desc,
    ): Promise<MessageShape<Desc>> {
      const org = executions[id];
      if (org === undefined) {
        return Promise.reject(new ResourceNotFoundError(id));
      }
      return Promise.resolve(
        create(schema, {
          metadata: { id, org },
        } as never) as MessageShape<Desc>,
      );
    },
    saveResource: async (_kind: ApiResourceKind, id: string) => {
      saved.push(id);
    },
    organizationDeletions: { isDeleting: async () => false },
  } as unknown as Store;
  const transport = createRouterTransport(
    (router) => {
      registerArtifactServices(router, {
        store,
        artifactStorage: {
          upload: async (hash: string) => {
            uploads.push(hash);
          },
          exists: async () => true,
        } as never,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
      });
    },
    {
      router: {
        interceptors: [
          createVerifierChainInterceptor([boundVerifier], [], silentLogger),
        ],
      },
    },
  );
  const client = createClient(ArtifactCommandController, transport);
  const createFor = (agentExecutionId: string) =>
    client.create(
      {
        spec: {
          displayName: "notes.md",
          contentType: "text/markdown",
          source: { agentExecutionId },
        },
        content: new TextEncoder().encode("# notes"),
      },
      { headers: { authorization: "Bearer bound-token" } },
    );
  return { uploads, saved, createFor };
}

describe("artifact create under a credential bound to one organization", () => {
  it("refuses an execution in another organization before anything is uploaded or saved", async () => {
    const h = harness();
    const error = await h.createFor("aex_in_b").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      BOUND_ELSEWHERE_DENY_REASON,
    );
    expect(h.uploads).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it("files an artifact for an execution in its own organization", async () => {
    const h = harness();
    const created = await h.createFor("aex_in_a");
    expect(created.metadata?.org).toBe("org_a");
    expect(h.uploads).toHaveLength(1);
    expect(h.saved).toHaveLength(1);
  });
});
