/**
 * Pins artifact create's deleting-rule seat (controller.ts
 * `refuseDeletingSourceOrganization`): the request names only its source
 * execution, so the deleting rule's interceptor never sees the
 * organization, and an execution of an organization being deleted would
 * otherwise file an artifact after the purge removed its organization's
 * artifacts. Refused NOT_FOUND with a missing organization's copy, before
 * anything is uploaded or saved; an execution of a live organization is
 * filed as before. The registered handler runs on an in-process router;
 * the store and the blob storage are recording fakes.
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

import { createLogger } from "../../../boot/logger.js";
import { createInProcessCallerInterceptor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerArtifactServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function harness(deleting: ReadonlySet<string>) {
  const uploads: string[] = [];
  const saved: string[] = [];
  const executions: Record<string, string> = {
    aex_live: "org_live",
    aex_deleting: "org_deleting",
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
    organizationDeletions: {
      isDeleting: async (org: string) => deleting.has(org),
    },
  } as unknown as Store;
  const transport = createRouterTransport(
    (router) => {
      registerArtifactServices(router, {
        store,
        artifactStorage: {
          upload: async (hash: string) => {
            uploads.push(hash);
          },
        } as never,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
      });
    },
    { router: { interceptors: [createInProcessCallerInterceptor()] } },
  );
  const client = createClient(ArtifactCommandController, transport);
  const createFor = (agentExecutionId: string) =>
    client.create({
      spec: {
        displayName: "notes.md",
        contentType: "text/markdown",
        source: { agentExecutionId },
      },
      content: new TextEncoder().encode("# notes"),
    });
  return { uploads, saved, createFor };
}

describe("artifact create for an execution of an organization being deleted", () => {
  it("refuses NOT_FOUND before anything is uploaded or saved", async () => {
    const h = harness(new Set(["org_deleting"]));
    const error = await h.createFor("aex_deleting").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toBe(
      "Organization not found: org_deleting",
    );
    expect(h.uploads).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it("files an execution of a live organization as before", async () => {
    const h = harness(new Set(["org_deleting"]));
    const artifact = await h.createFor("aex_live");
    expect(artifact.metadata?.org).toBe("org_live");
    expect(h.uploads).toHaveLength(1);
    expect(h.saved).toEqual([artifact.metadata?.id]);
  });
});
