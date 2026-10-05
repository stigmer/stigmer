/**
 * Pins artifact create's deleting-rule seat (controller.ts
 * `refuseDeletingSourceOrganization`): the request names only its source
 * execution, so the deleting rule's interceptor never sees the
 * organization, and an execution of an organization being deleted would
 * otherwise file an artifact after the purge removed its organization's
 * artifacts. Refused NOT_FOUND with a missing organization's copy, before
 * anything is uploaded or saved; an execution of a live organization is
 * filed as before; a deletion table that cannot be read answers INTERNAL,
 * with nothing uploaded. And the create's half of the shared-blob race
 * (artifact/purge.ts): a blob another organization's purge deleted
 * between this create's upload and its row is uploaded again. The registered handler runs on an in-process router;
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

function harness(
  deleting: ReadonlySet<string> | Error,
  options: { readonly blobGoneAfterSave?: boolean; readonly existsFault?: Error } = {},
) {
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
      isDeleting: async (org: string) => {
        if (deleting instanceof Error) {
          throw deleting;
        }
        return deleting.has(org);
      },
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
          // A purge of another organization deleting the shared blob
          // between this create's upload and its row.
          exists: async () => {
            if (options.existsFault !== undefined) throw options.existsFault;
            return options.blobGoneAfterSave !== true || uploads.length > 1;
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

  it("uploads its content again when another organization's purge deleted the shared blob before its row", async () => {
    const h = harness(new Set(), { blobGoneAfterSave: true });
    const artifact = await h.createFor("aex_live");
    expect(h.saved).toEqual([artifact.metadata?.id]);
    expect(h.uploads, "the upload, then the re-upload after the row").toHaveLength(2);
  });

  it("answers INTERNAL when the blob store cannot say whether its blob is still there", async () => {
    const h = harness(new Set(), { existsFault: new Error("bucket down") });
    const error = await h.createFor("aex_live").catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("failed to upload artifact content");
  });

  it("answers INTERNAL, with nothing uploaded, when the deletion table cannot be read", async () => {
    const h = harness(new Error("store down"));
    const error = await h.createFor("aex_live").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect(h.uploads).toEqual([]);
  });
});
