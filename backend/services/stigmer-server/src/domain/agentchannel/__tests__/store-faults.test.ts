/**
 * Pins the store-fault contract of the install lane's channel load, which
 * initiateInstall and completeInstall share: a typed ResourceNotFoundError
 * answers NotFound with the domain's pinned copy
 * (`AgentChannel not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the channel does not exist (stigmer/stigmer#1345).
 *
 * Both surfaces are reached through the registered handler on an in-process
 * router. The composed suites reach only a real store, which cannot fail
 * selectively, so each runs here against a store whose read throws. The
 * channel runtime and the model registry are untouchable: the load comes
 * before authorization and before the runtime, so a load that fails must
 * stop the call before either.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned by
 * agentchannel.test.ts and the agentchannel conformance suite) and
 * getByAgent's empty-list answer on an agent-read fault
 * (stigmer/stigmer#1375).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";

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
import { registerAgentChannelServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const CHANNEL_ID = "ach_storefault";

const NOT_FOUND_COPY = `AgentChannel not found: ${CHANNEL_ID}`;
const LOAD_FAULT_COPY = "failed to load agent channel";

const MISSING = (): Error =>
  new ResourceNotFoundError(`agent_channel/${CHANNEL_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

type ChannelCommand = Client<typeof AgentChannelCommandController>;

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind the
 * install load reads; the load is the first thing either handler does.
 */
function channelCommand(store: Store): ChannelCommand {
  const transport = createRouterTransport(
    (router) => {
      registerAgentChannelServices(router, {
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
  return createClient(AgentChannelCommandController, transport);
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
