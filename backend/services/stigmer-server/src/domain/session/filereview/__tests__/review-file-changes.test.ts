/**
 * Pins SessionCommandController.reviewFileChanges (../review-file-changes.ts):
 * served on the session's command service, it asks can_edit on the
 * session the input names before anything is read, refuses a word outside
 * the contract's, records keep and undo, change_set and file, as the
 * decided event in the same words naming the caller, and answers the
 * reconcile turn an undo on an ended turn started.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { ReviewFileChangesInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import type {
  Authorizer,
  AuthzCheck,
} from "../../../../extensions/authorizer.js";
import { servedMethods } from "../../../../extensions/__tests__/composed-support.js";
import {
  testCallerIdentity,
  untouchable,
} from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { fileReviewSeed } from "../../../run/__tests__/file-review-seed.js";
import { registerSessionServices } from "../../controller.js";
import type { SessionControllerDeps } from "../../controller.js";
import { SessionEventBroker } from "../../events/broker.js";
import { eventOf } from "../../events/codec.js";
import { createRunAppendingEvents } from "../../events/run-writes.js";
import { reviewFileChanges } from "../review-file-changes.js";
import type { ReviewFileChangesDeps } from "../review-file-changes.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const SESSION = "ses_1";

let temp: TempStore;
let reconcileCreates: number;

beforeEach(() => {
  temp = tempStore();
  reconcileCreates = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

function deps(
  authorizer: Authorizer = newPermissiveSingleTeamAuthorizer(),
): ReviewFileChangesDeps {
  return {
    store: temp.store,
    logger: silentLogger,
    authorizer,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    reconcileTurns: () => ({
      create: async (run) => {
        reconcileCreates += 1;
        const row = clone(RunSchema, run);
        row.metadata!.id = "run_reconcile";
        return row;
      },
    }),
  };
}

/** One ended turn of the session with one captured change set, `run_1:1`. */
async function seedEndedTurn() {
  const seed = fileReviewSeed("run_1", "run_1:1");
  await createRunAppendingEvents(
    {
      store: temp.store,
      sessionEventBroker: new SessionEventBroker(silentLogger),
    },
    create(RunSchema, {
      metadata: { id: "run_1", org: "org_acme" },
      spec: {
        target: { case: "sessionId", value: SESSION },
        message: "edit a.ts",
      },
      status: { ...seed.status, phase: RunPhase.RUN_COMPLETED },
    }),
  );
  return seed;
}

function review(
  input: {
    readonly sessionId?: string;
    readonly scope?: string;
    readonly fileChangeId?: string;
    readonly action?: string;
    readonly expectedDigest?: string;
  },
  over: ReviewFileChangesDeps = deps(),
) {
  return reviewFileChanges(
    over,
    create(ReviewFileChangesInputSchema, {
      sessionId: SESSION,
      changeSetId: "run_1:1",
      scope: "change_set",
      action: "keep",
      expectedDigest: "0".repeat(64),
      ...input,
    }),
    testCallerIdentity({ identityId: "usr_person" }),
  );
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

/** The decided events of `run_1` in the session's log: scope, action, file and decider. */
async function decisions() {
  const records = await temp.store.sessionEvents.list(SESSION, {
    order: "asc",
    runId: "run_1",
    types: ["stigmer.file_review.decided"],
    limit: 10,
  });
  return records.map(eventOf).flatMap((event) =>
    event.event.case === "stigmerFileReviewDecided"
      ? [[event.event.value.scope, event.event.value.action, event.event.value.fileChangeId, event.event.value.decidedBy]]
      : [],
  );
}

describe("reviewFileChanges", () => {
  it("is served on the session's command service", () => {
    const served = servedMethods((router) =>
      registerSessionServices(
        router,
        untouchable<SessionControllerDeps>("deps"),
      ),
    )
      .filter(
        (method) =>
          method.parent.typeName === SessionCommandController.typeName,
      )
      .map((method) => method.localName);
    expect(served).toContain("reviewFileChanges");
    expect(served).toHaveLength(SessionCommandController.methods.length);
  });

  it("asks can_edit on the session it names before reading anything, and a denial writes nothing", async () => {
    const seed = await seedEndedTurn();
    const checks: AuthzCheck[] = [];
    const denying: Authorizer = {
      authorize: async (_caller, check) => {
        checks.push(check);
        return { kind: "deny", reason: "not an editor" };
      },
    };
    const error = await refusal(
      review({ expectedDigest: seed.aggregate }, deps(denying)),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(
      checks.map((c) => [c.permission, c.resourceKind, c.resourceId]),
    ).toEqual([[IamPermission.can_edit, ApiResourceKind.session, SESSION]]);
    expect(await decisions()).toEqual([]);
  });

  it("refuses a word outside the contract's", async () => {
    await seedEndedTurn();
    expect((await refusal(review({ action: "approve" }))).code).toBe(
      Code.InvalidArgument,
    );
    expect((await refusal(review({ scope: "CHANGE_SET" }))).code).toBe(
      Code.InvalidArgument,
    );
    expect((await refusal(review({ scope: "file" }))).code).toBe(
      Code.InvalidArgument,
    );
  });

  it("a keep of the whole set is recorded as said, naming the caller, and starts no turn", async () => {
    const seed = await seedEndedTurn();
    const response = await review({ expectedDigest: seed.aggregate });
    expect(response.reconcileRunId).toBe("");
    expect(await decisions()).toEqual([["change_set", "keep", "", "usr_person"]]);
    expect(reconcileCreates).toBe(0);
  });

  it("an undo of one file is recorded as said, and names the reconcile turn it started", async () => {
    const seed = await seedEndedTurn();
    const response = await review({
      scope: "file",
      fileChangeId: seed.change.id,
      action: "undo",
      expectedDigest: seed.change.fileDigest,
    });
    expect(response.reconcileRunId).toBe("run_reconcile");
    expect(await decisions()).toEqual([["file", "undo", seed.change.id, "usr_person"]]);
    expect(reconcileCreates).toBe(1);
  });

  it("a change set of another session is NOT_FOUND", async () => {
    const seed = await seedEndedTurn();
    const error = await refusal(
      review({ sessionId: "ses_other", expectedDigest: seed.aggregate }),
    );
    expect(error.code).toBe(Code.NotFound);
    expect(await decisions()).toEqual([]);
  });
});
