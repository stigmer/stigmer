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
 * checks, the usage report's LoadExecution, and the two decision verbs'
 * LoadExisting. The composed suites reach only a real store, which cannot
 * fail selectively, so each surface runs here against a store whose one read
 * throws. Every other dependency is untouchable: a load that fails must stop
 * the call before any of them.
 *
 * The locked writes get the same contract for a run deleted between the load
 * and the write: the lifecycle persist and the two decision writes answer
 * NotFound naming the run, never a resurrected row or an Internal. Those run
 * against a store whose read answers a run parked where the verb accepts it
 * and whose locked update finds the row gone.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned where each
 * surface is otherwise tested) and loads outside this domain.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import type { MessageInitShape } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  FileDecisionAction,
  FileDecisionScope,
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  RunIdSchema,
  CancelRunInputSchema,
  GetArtifactContentRequestSchema,
  GetArtifactDownloadUrlRequestSchema,
  PauseRunInputSchema,
  RecoverRunInputSchema,
  ResumeRunInputSchema,
  SubmitApprovalInputSchema,
  SubmitFileDecisionInputSchema,
  TerminateRunInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { KeyedSerializer } from "../../../pipeline/keyed-serializer.js";
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
import type { SubmitApprovalDeps } from "../submit-approval.js";
import { submitApproval } from "../submit-approval.js";
import type { SubmitFileDecisionDeps } from "../submit-file-decision.js";
import { submitFileDecision } from "../submit-file-decision.js";
import { subscribeExecution } from "../subscribe.js";
import { getRunUsageReport } from "../usage.js";

import { stubConnectedEngine } from "./engine-stub.js";
import { fileReviewSeed } from "./file-review-seed.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const EXECUTION_ID = "aex_storefault";

const LOAD_FAULT_COPY = "failed to load agent execution";

const MISSING = (): Error =>
  new ResourceNotFoundError(`agent_run/${EXECUTION_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

function lifecycleDeps(store: Store): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    recoverSerializer: new KeyedSerializer(),
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
        create(CancelRunInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "terminate",
    (deps) =>
      terminateExecution(
        deps,
        create(TerminateRunInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "pause",
    (deps) =>
      pauseExecution(
        deps,
        create(PauseRunInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "resume",
    (deps) =>
      resumeExecution(
        deps,
        create(ResumeRunInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
  ],
  [
    "recover",
    (deps) =>
      recoverExecution(
        deps,
        create(RecoverRunInputSchema, { id: EXECUTION_ID }),
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
    expect(error.rawMessage).toBe(`agent_run not found: ${EXECUTION_ID}`);
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
        create(RunIdSchema, { value: EXECUTION_ID }),
        handlerContext(),
      ).next(),
    );
  }

  it("a missing execution answers NotFound with the subscribe copy", async () => {
    const broker = new StreamBroker(silentLogger);
    const error = await subscribeError(failingStore(MISSING()), broker);

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`AgentRun not found: ${EXECUTION_ID}`);
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
            runId: EXECUTION_ID,
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
            runId: EXECUTION_ID,
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

describe("getRunUsageReport — LoadExecution", () => {
  function reportError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      getRunUsageReport(
        {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          listReadScope: undefined,
        },
        create(
          RunQueryController.method.getRunUsageReport.input,
          { runId: EXECUTION_ID },
        ),
        testCallerIdentity(),
      ),
    );
  }

  it("a missing execution answers NotFound with the domain's copy", async () => {
    const error = await reportError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_run not found: ${EXECUTION_ID}`);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await reportError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

function approvalDeps(store: Store): SubmitApprovalDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker: untouchable("broker"),
    engineState: untouchable("engineState"),
    gateSteps: new Map(),
    statusObservers: [],
  };
}

function fileDecisionDeps(store: Store): SubmitFileDecisionDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker: untouchable("broker"),
    engineState: untouchable("engineState"),
    statusObservers: [],
  };
}

const CHANGE_SET_ID = "cs_storefault";

function approveToolCall(deps: SubmitApprovalDeps): Promise<unknown> {
  return submitApproval(
    deps,
    create(SubmitApprovalInputSchema, {
      runId: EXECUTION_ID,
      toolCallId: "tc-1",
      action: ApprovalAction.APPROVE,
    }),
    testCallerIdentity(),
  );
}

function keepChangeSet(
  deps: SubmitFileDecisionDeps,
  expectedDigest: string,
): Promise<unknown> {
  return submitFileDecision(
    deps,
    create(SubmitFileDecisionInputSchema, {
      runId: EXECUTION_ID,
      changeSetId: CHANGE_SET_ID,
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest,
    }),
    testCallerIdentity(),
  );
}

describe.each([
  ["submitApproval", () => approveToolCall(approvalDeps(failingStore(MISSING())))],
  ["submitFileDecision", () => keepChangeSet(fileDecisionDeps(failingStore(MISSING())), "sha256:any")],
] as const)("%s — LoadExisting, a missing run", (_verb, call) => {
  it("answers NotFound naming the run", async () => {
    const error = await errorOf(call);

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_run not found: ${EXECUTION_ID}`);
  });
});

describe.each([
  ["submitApproval", () => approveToolCall(approvalDeps(failingStore(LOCKED())))],
  ["submitFileDecision", () => keepChangeSet(fileDecisionDeps(failingStore(LOCKED())), "sha256:any")],
] as const)("%s — LoadExisting, any other store failure", (_verb, call) => {
  it("answers a sanitized Internal", async () => {
    const error = await errorOf(call);

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

/**
 * A store whose read answers `run` and whose locked update finds the row
 * gone, the shape of a delete landing between a verb's load and its write.
 */
function deletedBeforeWriteStore(
  run: MessageInitShape<typeof RunSchema>,
): Store {
  return {
    getResource: () => Promise.resolve(create(RunSchema, run)),
    updateResource: () => Promise.reject(MISSING()),
  } as unknown as Store;
}

describe("a run deleted between the load and the locked write", () => {
  it("a lifecycle persist answers NotFound naming the run", async () => {
    const store = deletedBeforeWriteStore({
      metadata: { id: EXECUTION_ID },
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    });
    const error = await errorOf(() =>
      cancelExecution(
        {
          ...lifecycleDeps(store),
          engineState: () => ({ connected: true, engine: stubConnectedEngine() }),
        },
        create(CancelRunInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_run not found: ${EXECUTION_ID}`);
  });

  it("an approval write answers NotFound naming the run", async () => {
    const store = deletedBeforeWriteStore({
      metadata: { id: EXECUTION_ID },
      status: {
        phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
        messages: [
          {
            toolCalls: [
              {
                id: "tc-1",
                name: "Write",
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                requiresApproval: true,
              },
            ],
          },
        ],
      },
    });
    const error = await errorOf(() => approveToolCall(approvalDeps(store)));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_run not found: ${EXECUTION_ID}`);
  });

  it("a file-decision write answers NotFound naming the run", async () => {
    const { status, aggregate } = fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID);
    const store = deletedBeforeWriteStore({
      metadata: { id: EXECUTION_ID },
      status,
    });
    const error = await errorOf(() =>
      keepChangeSet(fileDecisionDeps(store), aggregate),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`agent_run not found: ${EXECUTION_ID}`);
  });
});
