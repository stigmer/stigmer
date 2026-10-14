/**
 * Pins the store-fault contract of the plugin's visibility-update load: a
 * typed ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`plugin not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound that
 * tells a client the plugin does not exist (stigmer/stigmer#1345).
 *
 * The surface is updateVisibility, reached through the registered handler on
 * an in-process router. The composed suites reach only a real store, which
 * cannot fail selectively, so it runs here against a store whose read throws.
 * The archive store, the outbound fetch and the tools lane are untouchable:
 * a load that fails must stop the call before anything else is reached.
 *
 * The delete's reference guard is pinned the same way: a store whose agent
 * listing fails answers a sanitized Internal before anything is deleted.
 *
 * The listTools route is pinned to reach the tools lane: an input the lane
 * refuses is refused through the registered handler, with the tools deps
 * untouched.
 *
 * Out of scope: the NotFound copy itself (wire contract).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerPluginServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const PLUGIN_ID = "plg_storefault";

const NOT_FOUND_COPY = `plugin not found: ${PLUGIN_ID}`;
const LOAD_FAULT_COPY = "failed to load plugin";

const MISSING = (): Error => new ResourceNotFoundError(`plugin/${PLUGIN_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind, then
 * Authorize and ValidateProto run and the load is the first step that reads
 * the store.
 */
function pluginCommand(store: Store): Client<typeof PluginCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerPluginServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        listReadScope: undefined,
        artifactStorage: untouchable("artifactStorage"),
        outboundFetch: () =>
          Promise.reject(
            new Error("outboundFetch reached after a failed load"),
          ),
        tools: untouchable("tools"),
      });
    },
    {
      router: {
        interceptors: [
          createVerifierChainInterceptor([], [], silentLogger),
          createApiResourceInterceptor(),
        ],
      },
    },
  );
  return createClient(PluginCommandController, transport);
}

describe("updateVisibility — LoadPluginForVisibilityUpdate", () => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      pluginCommand(store).updateVisibility({
        resourceId: PLUGIN_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );
  }

  it("a missing plugin answers NotFound with the domain's copy", async () => {
    const error = await surfaceError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await surfaceError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

describe("delete — GuardPluginUnlisted", () => {
  it("a failure to list the agents answers a sanitized Internal, and deletes nothing", async () => {
    const plugin = create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, { id: PLUGIN_ID, org: "org_acme", slug: "acme" }),
    });
    const deleted: string[] = [];
    const store = {
      getResource: () => Promise.resolve(plugin),
      listResources: () => Promise.reject(LOCKED()),
      deleteResource: (_kind: unknown, id: string) => {
        deleted.push(id);
        return Promise.resolve();
      },
    } as unknown as Store;

    const error = await errorOf(() => pluginCommand(store).delete({ value: PLUGIN_ID }));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to list agents for the plugin reference check");
    expect(deleted).toEqual([]);
  });
});

describe("listTools — the registered route", () => {
  it("reaches the tools lane, which refuses an input without a server before it reads anything", async () => {
    const error = await errorOf(() =>
      pluginCommand(failingStore(LOCKED())).listTools({ pluginId: PLUGIN_ID, server: "", org: "org_acme" }),
    );

    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("plugin_id and server are required");
  });
});
