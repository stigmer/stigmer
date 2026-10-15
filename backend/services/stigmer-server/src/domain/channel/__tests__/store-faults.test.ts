/**
 * Pins the store-fault contract of the channel loads the command lanes
 * share: the install lane's (initiateInstall and completeInstall) and
 * rotateLink's. A typed ResourceNotFoundError answers NotFound with the
 * domain's pinned copy (`Channel not found: <id>`), and any other store
 * failure is an infrastructure fault answered as a sanitized Internal, never
 * a NotFound that tells a client the channel does not exist
 * (stigmer/stigmer#1345). Rotation is how an owner kills a leaked link, so a
 * fault that reads as a missing channel would leave the link live behind a
 * false answer.
 *
 * Each surface is reached through the registered handler on an in-process
 * router. The composed suites reach only a real store, which cannot fail
 * selectively, so each runs here against a store whose read throws. The
 * channel runtime and the model registry are untouchable: each load comes
 * before the runtime, so a load that fails must stop the call before it.
 *
 * The agent profile's agent read is pinned the same way: a fault reading the
 * agent is a sanitized Internal, never a missing agent.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned by
 * channel.test.ts and the channel conformance suite), the anonymous profile
 * lanes' deliberate uniform NotFound, and listByAgent's empty-list answer on
 * an agent-read fault (stigmer/stigmer#1375).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, ConnectError as ConnectErrorClass, createClient, createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/command_pb";

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

import type { ChannelRuntime } from "../channel-runtime.js";
import { registerChannelServices } from "../controller.js";
import { buildChannelAgentProfile } from "../steps.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../authorization/__tests__/unbound-credential-binding.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const CHANNEL_ID = "ach_storefault";

const NOT_FOUND_COPY = `Channel not found: ${CHANNEL_ID}`;
const LOAD_FAULT_COPY = "failed to load channel";

const MISSING = (): Error =>
  new ResourceNotFoundError(`channel/${CHANNEL_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

type ChannelCommand = Client<typeof ChannelCommandController>;

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind each
 * load reads; after Authorize and ValidateProto, the load is the first step
 * that reads the store.
 */
function channelCommand(store: Store): ChannelCommand {
  const transport = createRouterTransport(
    (router) => {
      registerChannelServices(router, {
        credentialBinding: UNBOUND_CREDENTIAL_BINDING,
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        modelRegistry: untouchable("modelRegistry"),
        channelRuntime: untouchable<ChannelRuntime>("channelRuntime"),
        listReadScope: undefined,
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
  return createClient(ChannelCommandController, transport);
}

/** Each surface with the input its proto requires. */
const SURFACES: ReadonlyArray<
  readonly [string, (command: ChannelCommand) => Promise<unknown>]
> = [
  [
    "initiateInstall — the install load",
    (command) => command.initiateInstall({ resourceId: CHANNEL_ID }),
  ],
  [
    "completeInstall — the install load",
    (command) =>
      command.completeInstall({
        resourceId: CHANNEL_ID,
        state: "install-state",
        code: "provider-code",
      }),
  ],
  [
    "rotateLink — the link-rotation load",
    (command) => command.rotateLink({ resourceId: CHANNEL_ID }),
  ],
];

describe.each(SURFACES)("%s", (_name, call) => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() => call(channelCommand(store)));
  }

  it("a missing channel answers NotFound with the domain's copy", async () => {
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

describe("the agent profile's agent read", () => {
  it("answers a fault reading the agent by its id as the domain's sanitized Internal", async () => {
    const faulting = {
      getResource: () => Promise.reject(LOCKED()),
    } as unknown as Store;
    const channel = create(ChannelSchema, {
      metadata: { id: CHANNEL_ID, org: "org_acme", slug: "support" },
      spec: { agentRef: { org: "org_acme", id: "agt_support" }, type: { case: "web", value: {} } },
    });
    const error = await buildChannelAgentProfile(faulting, channel).then(
      () => undefined,
      (caught: unknown) => ConnectErrorClass.from(caught),
    );
    expect(error?.code).toBe(Code.Internal);
    expect(error?.rawMessage).toBe("failed to read the agent");
  });
});
