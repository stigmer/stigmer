/**
 * Pins the store-fault contract every agent-execution load shares: a typed
 * ResourceNotFoundError answers NotFound with the surface's own pinned copy,
 * and any other store failure is an infrastructure fault answered as a
 * sanitized Internal (`failed to load agent execution`), never a NotFound
 * that tells a client the execution does not exist (stigmer/stigmer#859,
 * stigmer/stigmer#1337).
 *
 * The surfaces: the five lifecycle verbs (their shared LoadExecutionById
 * step), subscribe's snapshot read, the two artifact reads' existence
 * checks, and the usage report's LoadExecution. The composed suites reach
 * only a real store, which cannot fail selectively, so each surface runs
 * here against a store whose one read throws. Every other dependency is
 * untouchable: a load that fails must stop the call before any of them.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned where each
 * surface is otherwise tested) and loads outside this domain.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  AgentExecutionIdSchema,
  CancelAgentExecutionInputSchema,
  GetArtifactContentRequestSchema,
  GetArtifactDownloadUrlRequestSchema,
  PauseAgentExecutionInputSchema,
  RecoverAgentExecutionInputSchema,
  ResumeAgentExecutionInputSchema,
  TerminateAgentExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  testCallerIdentity,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { getArtifactContent, getArtifactDownloadUrl } from "../artifacts.js";
import type { LifecycleDeps } from "../lifecycle.js";
import {
  cancelExecution,
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "../lifecycle.js";
import { StreamBroker } from "../stream-broker.js";
import { subscribeExecution } from "../subscribe.js";
import { getExecutionUsageReport } from "../usage.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const EXECUTION_ID = "aex_storefault";

const LOAD_FAULT_COPY = "failed to load agent execution";

const MISSING = (): Error =>
  new ResourceNotFoundError(`agent_execution/${EXECUTION_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

function lifecycleDeps(store: Store): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker: untouchable("broker"),
    engineState: untouchable("engineState"),
    executionContextBuilder: untouchable("executionContextBuilder"),
    gateSteps: new Map(),
    statusObservers: [],
    sandboxLane: untouchable("sandboxLane"),
    temporalConfig: untouchable("temporalConfig"),
  };
}

const LIFECYCLE_VERBS: ReadonlyArray<
  readonly [string, (deps: LifecycleDeps) => Promise<unknown>]
> = [
  [
    "cancel",
    (deps) =>
      cancelExecution(
        deps,
        create(CancelAgentExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "terminate",
    (deps) =>
      terminateExecution(
        deps,
        create(TerminateAgentExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "pause",
    (deps) =>
      pauseExecution(
        deps,
        create(PauseAgentExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "resume",
    (deps) =>
      resumeExecution(
        deps,
        create(ResumeAgentExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "recover",
    (deps) =>
      recoverExecution(
        deps,
        create(RecoverAgentExecutionInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
];

describe.each(LIFECYCLE_VERBS)("%s — LoadExecutionById", (_verb, run) => {
  it("a missing execution answers NotFound with the lifecycle copy", async () => {
    const error = await errorOf(() =>
      run(lifecycleDeps(failingStore(MISSING()))),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_execution not found: ${EXECUTION_ID}`);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() =>
      run(lifecycleDeps(failingStore(LOCKED()))),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

describe("subscribe — the snapshot read", () => {
  function handlerContext(): HandlerContext {
    const values = createContextValues();
    values.set(callerIdentityKey, testCallerIdentity());
    return { signal: new AbortController().signal, values } as HandlerContext;
  }

  async function subscribeError(
    store: Store,
    broker: StreamBroker,
  ): Promise<ConnectError> {
    return errorOf(() =>
      subscribeExecution(
        {
          store,
          logger: silentLogger,
          broker,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(AgentExecutionIdSchema, { value: EXECUTION_ID }),
        handlerContext(),
      ).next(),
    );
  }

  it("a missing execution answers NotFound with the subscribe copy", async () => {
    const broker = new StreamBroker(silentLogger);
    const error = await subscribeError(failingStore(MISSING()), broker);

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`AgentExecution not found: ${EXECUTION_ID}`);
    expect(broker.getSubscriberCount(EXECUTION_ID)).toBe(0);
  });

  it("any other store failure answers a sanitized Internal and releases the subscription", async () => {
    const broker = new StreamBroker(silentLogger);
    const error = await subscribeError(failingStore(LOCKED()), broker);

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
    expect(broker.getSubscriberCount(EXECUTION_ID)).toBe(0);
  });
});

describe("artifact reads — the existence check", () => {
  function artifactDeps(store: Store) {
    return {
      store,
      logger: silentLogger,
      artifactStorage: untouchable<ArtifactStorage>("artifactStorage"),
      authorizer: newPermissiveSingleTeamAuthorizer(),
    };
  }

  // getArtifactContent checks the key's prefix before its load, so the key
  // sits under the execution; getArtifactDownloadUrl loads first.
  const ARTIFACT_READS: ReadonlyArray<
    readonly [string, (store: Store) => Promise<unknown>]
  > = [
    [
      "getArtifactContent",
      (store) =>
        getArtifactContent(
          artifactDeps(store),
          create(GetArtifactContentRequestSchema, {
            executionId: EXECUTION_ID,
            storageKey: `artifacts/${EXECUTION_ID}/out.txt`,
          }),
          testCallerIdentity(),
        ),
    ],
    [
      "getArtifactDownloadUrl",
      (store) =>
        getArtifactDownloadUrl(
          artifactDeps(store),
          create(GetArtifactDownloadUrlRequestSchema, {
            executionId: EXECUTION_ID,
            storageKey: `artifacts/${EXECUTION_ID}/out.txt`,
          }),
          testCallerIdentity(),
        ),
    ],
  ];

  describe.each(ARTIFACT_READS)("%s", (_read, run) => {
    it("a missing execution answers NotFound with the artifact copy", async () => {
      const error = await errorOf(() => run(failingStore(MISSING())));

      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe(`execution not found: ${EXECUTION_ID}`);
    });

    it("any other store failure answers a sanitized Internal", async () => {
      const error = await errorOf(() => run(failingStore(LOCKED())));

      expect(error.code).toBe(Code.Internal);
      expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
    });
  });
});

describe("getExecutionUsageReport — LoadExecution", () => {
  function reportError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      getExecutionUsageReport(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          listReadScope: undefined,
        },
        create(
          AgentExecutionQueryController.method.getExecutionUsageReport.input,
          { executionId: EXECUTION_ID },
        ),
        testCallerIdentity(),
      ),
    );
  }

  it("a missing execution answers NotFound with the domain's copy", async () => {
    const error = await reportError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_execution not found: ${EXECUTION_ID}`);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await reportError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});
