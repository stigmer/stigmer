/**
 * Pins the store-fault contract every agent-execution load shares: a typed
 * ResourceNotFoundError answers NotFound with the surface's own pinned copy,
 * and any other store failure is an infrastructure fault answered as a
 * sanitized Internal (`failed to load agent execution`), never a NotFound
 * that tells a client the execution does not exist (stigmer/stigmer#859,
 * stigmer/stigmer#1337).
 *
 * The surfaces: the four lifecycle verbs (their shared LoadExecutionById
 * step), the two artifact reads' existence checks, the usage report's
 * LoadExecution, and the file-decision core's load of the change set's
 * run. The composed suites reach only a real store, which cannot
 * fail selectively, so each surface runs here against a store whose one read
 * throws. Every other dependency is untouchable: a load that fails must stop
 * the call before any of them.
 *
 * The locked writes get the same contract for a run deleted between the load
 * and the write: the lifecycle persist and an answer's write answer NotFound
 * naming the run, and a file decision's write NotFound naming the change
 * set, never a resurrected row or an Internal. Those run
 * against a store whose read answers a run parked where the verb accepts it
 * and whose locked update finds the row gone.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned where each
 * surface is otherwise tested) and loads outside this domain.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import type { MessageInitShape } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  GetArtifactContentRequestSchema,
  GetArtifactDownloadUrlRequestSchema,
  PauseRunInputSchema,
  RecoverRunInputSchema,
  ResumeRunInputSchema,
  TerminateRunInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { ConfirmToolUseInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
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
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "../lifecycle.js";
import { getRunUsageReport } from "../usage.js";
import { confirmToolUse } from "../../session/hitl/confirm-tool-use.js";
import type { SessionAnswerDeps } from "../../session/hitl/confirm-tool-use.js";
import { decideFileChanges } from "../../session/filereview/decide.js";
import type { FileDecisionDeps } from "../../session/filereview/decide.js";

import { stubConnectedEngine } from "./engine-stub.js";
import { fileReviewSeed } from "./file-review-seed.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { draftOf } from "../../session/events/codec.js";
import type { SessionEventQuery } from "../../../store/session-events.js";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const EXECUTION_ID = "run_storefault";

const LOAD_FAULT_COPY = "failed to load agent execution";

const MISSING = (): Error =>
  new ResourceNotFoundError(`run/${EXECUTION_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

function lifecycleDeps(store: Store): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    recoverSerializer: new KeyedSerializer(),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    engineState: untouchable("engineState"),
    runValuePlanner: untouchable("runValuePlanner"),
    gateSteps: new Map(),
    statusObservers: [],
    sandboxLane: untouchable("sandboxLane"),
    temporalConfig: untouchable("temporalConfig"),
    personAccounts: undefined,
  };
}

const LIFECYCLE_VERBS: ReadonlyArray<
  readonly [string, (deps: LifecycleDeps) => Promise<unknown>]
> = [
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
    expect(error.rawMessage).toBe(`Run not found: ${EXECUTION_ID}`);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() =>
      run(lifecycleDeps(failingStore(LOCKED()))),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
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
          meteredUsageProvider: undefined,
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
    expect(error.rawMessage).toBe(`Run not found: ${EXECUTION_ID}`);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await reportError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

const SESSION_ID = "ses_storefault";
const CHANGE_SET_ID = `${EXECUTION_ID}:0`;

function answerDeps(store: Store): SessionAnswerDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    engineState: untouchable("engineState"),
    gateSteps: new Map(),
    statusObservers: [],
  };
}

function fileDecisionDeps(store: Store): FileDecisionDeps {
  return {
    store,
    logger: silentLogger,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    reconcileTurns: untouchable("reconcileTurns"),
  };
}

function allowToolUse(deps: SessionAnswerDeps): Promise<unknown> {
  return confirmToolUse(
    deps,
    create(ConfirmToolUseInputSchema, {
      sessionId: SESSION_ID,
      toolUseId: `${EXECUTION_ID}.tc-1`,
      result: "allow",
    }),
    testCallerIdentity(),
  );
}

function keepChangeSet(deps: FileDecisionDeps, expectedDigest: string): Promise<unknown> {
  return decideFileChanges(
    deps,
    { runId: EXECUTION_ID, sessionId: SESSION_ID },
    {
      changeSetId: CHANGE_SET_ID,
      scope: "change_set",
      fileChangeId: "",
      action: "keep",
      expectedDigest,
      reason: "",
      acknowledgeUnreviewable: false,
    },
    testCallerIdentity(),
  );
}

describe("the file-decision core — the change set's run", () => {
  it("a missing run answers NotFound naming the change set", async () => {
    const error = await errorOf(() => keepChangeSet(fileDecisionDeps(failingStore(MISSING())), "sha256:any"));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain(CHANGE_SET_ID);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() => keepChangeSet(fileDecisionDeps(failingStore(LOCKED())), "sha256:any"));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

/**
 * A store whose read answers `run` and whose locked update finds the row
 * gone, the shape of a delete landing between a verb's load and its write.
 */
/**
 * A store whose run reads back but is gone at the write; its log holds
 * `asks` (tool use ids of the run that wait), each open.
 */
function deletedBeforeWriteStore(
  run: MessageInitShape<typeof RunSchema>,
  asks: ReadonlyArray<string> = [],
): Store {
  const runId = run.metadata?.id ?? "";
  const records = asks.map((id, i) => ({
    ...draftOf(
      create(SessionEventSchema, {
        runId,
        event: { case: "agentToolUse", value: { id, name: "Write", input: {}, evaluatedPermission: "ask" } },
      }),
    ),
    sessionId: "",
    seq: i + 1,
    processedAt: "2026-10-13T00:00:00.000Z",
  }));
  return {
    getResource: () => Promise.resolve(create(RunSchema, run)),
    updateResource: () => Promise.reject(MISSING()),
    writeResourceAppendingEvents: () => Promise.reject(MISSING()),
    sessionEvents: {
      list: (_sessionId: string, query: SessionEventQuery) =>
        Promise.resolve(query.eventIds === undefined ? [] : records.filter((r) => query.eventIds!.includes(r.eventId))),
      openGates: () => Promise.resolve(asks.map((toolUseId, i) => ({ runId, toolUseId, seq: i + 1 }))),
    },
  } as unknown as Store;
}

describe("a run deleted between the load and the locked write", () => {
  it("a lifecycle persist answers NotFound naming the run", async () => {
    const store = deletedBeforeWriteStore({
      metadata: { id: EXECUTION_ID },
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    });
    const error = await errorOf(() =>
      terminateExecution(
        {
          ...lifecycleDeps(store),
          engineState: () => ({ connected: true, engine: stubConnectedEngine() }),
        },
        create(TerminateRunInputSchema, { id: EXECUTION_ID }),
        testCallerIdentity(),
      ),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`Run not found: ${EXECUTION_ID}`);
  });

  it("an answer's write answers NotFound naming the run", async () => {
    const store = deletedBeforeWriteStore({
      metadata: { id: EXECUTION_ID },
      spec: { target: { case: "sessionId", value: SESSION_ID } },
      status: { phase: RunPhase.RUN_WAITING_FOR_APPROVAL },
    }, [`${EXECUTION_ID}.tc-1`]);
    const error = await errorOf(() => allowToolUse(answerDeps(store)));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`Run not found: ${EXECUTION_ID}`);
  });

  it("a file-decision write answers NotFound naming the change set", async () => {
    const { status, aggregate } = fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID);
    const store = deletedBeforeWriteStore({
      metadata: { id: EXECUTION_ID },
      spec: { target: { case: "sessionId", value: SESSION_ID } },
      status,
    });
    const error = await errorOf(() =>
      keepChangeSet(fileDecisionDeps(store), aggregate),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain(CHANGE_SET_ID);
  });
});
