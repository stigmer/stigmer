/**
 * Pins the store-fault contract the artifact load by id shares: a typed
 * ResourceNotFoundError answers NotFound with the domain's pinned Go copy
 * (`Artifact not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client a run's output does not exist (stigmer/stigmer#1345).
 *
 * The surfaces: the three direct handlers that load through
 * loadArtifactOrNotFound, delete, getDownloadUrl and getContent, each
 * reached through the registered handler on an in-process router. All three
 * load before they authorize (stigmer#224), and a fault answered as Internal
 * says nothing about whether the artifact exists. The composed suites reach
 * only a real store, which cannot fail selectively, so each surface runs here
 * against a store whose read throws. Artifact storage is untouchable: a load
 * that fails must stop the call before any blob read or URL mint.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned by the
 * artifact conformance suite) and create's best-effort org derivation
 * (stigmer/stigmer#1369).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ArtifactQueryController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerArtifactServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ARTIFACT_ID = "art_storefault";

const NOT_FOUND_COPY = `Artifact not found: ${ARTIFACT_ID}`;
const LOAD_FAULT_COPY = "failed to load artifact";

const MISSING = (): Error =>
  new ResourceNotFoundError(`artifact/${ARTIFACT_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

interface ArtifactClients {
  readonly command: Client<typeof ArtifactCommandController>;
  readonly query: Client<typeof ArtifactQueryController>;
}

/**
 * The registered handlers on an in-process router (`artifact.test.ts`'s
 * harness): the verifier chain stamps the trusted-local caller, each handler
 * checks its id, and the load is the first read of the store.
 */
function artifactClients(store: Store): ArtifactClients {
  const transport = createRouterTransport(
    (router) => {
      registerArtifactServices(router, {
        store,
        artifactStorage: untouchable("artifactStorage"),
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
      });
    },
    {
      router: {
        interceptors: [createVerifierChainInterceptor([], [], silentLogger)],
      },
    },
  );
  return {
    command: createClient(ArtifactCommandController, transport),
    query: createClient(ArtifactQueryController, transport),
  };
}

const SURFACES: ReadonlyArray<
  readonly [string, (clients: ArtifactClients) => Promise<unknown>]
> = [
  ["delete", ({ command }) => command.delete({ value: ARTIFACT_ID })],
  [
    "getDownloadUrl",
    ({ query }) => query.getDownloadUrl({ value: ARTIFACT_ID }),
  ],
  ["getContent", ({ query }) => query.getContent({ artifactId: ARTIFACT_ID })],
];

describe.each(SURFACES)("%s — loadArtifactOrNotFound", (_name, call) => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() => call(artifactClients(store)));
  }

  it("a missing artifact answers NotFound with the domain's copy", async () => {
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
