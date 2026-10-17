/**
 * Pins how resume's clearing step (resume.ts) answers the store's faults
 * and races, which the composed suite cannot stage between the load and
 * the clear:
 *   - a routine deleted after its load answers NOT_FOUND, whether the
 *     clear finds it gone or the no-op path's re-read does: the delete won;
 *   - a clear, or a no-op path's re-read, the store cannot do answers
 *     INTERNAL, never a resumed routine.
 *
 * The store is a real throwaway SQLite store, with one method faulted
 * where a case says so.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { errorOf, testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newClearRoutinePauseStep } from "../resume.js";
import { storeWith } from "./support.js";

const ROUTINE_ID = "rtn_resume";

let temp: TempStore | undefined;

afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

/** A routine as its load found it: paused by the platform, or clear. */
function loaded(paused: boolean): Routine {
  return create(RoutineSchema, {
    metadata: { id: ROUTINE_ID, org: "org_acme", name: "Resume" },
    spec: { enabled: true, timeZone: "UTC" },
    status: paused ? { pausedReason: "failed 3 times in a row", consecutiveFailures: 3 } : {},
  });
}

function resumeContext(routine: Routine) {
  const ctx = new RequestContext(
    RoutineCommandController.method.resume.input,
    create(RoutineCommandController.method.resume.input, { value: ROUTINE_ID }),
    testCallerIdentity(),
    ApiResourceKind.routine,
  );
  ctx.set(EXISTING_RESOURCE_KEY, routine);
  return ctx;
}

async function stored(routine: Routine): Promise<Store> {
  temp = tempStore();
  await temp.store.saveResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema, routine);
  return temp.store;
}

describe("ClearRoutinePause — the clear", () => {
  it("answers NOT_FOUND naming the routine when it was deleted after its load", async () => {
    temp = tempStore();
    const error = await errorOf(async () => {
      await newClearRoutinePauseStep(temp!.store).execute(resumeContext(loaded(true)));
    });
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain(ROUTINE_ID);
  });

  it("answers INTERNAL when the store cannot write the clear", async () => {
    const routine = loaded(true);
    const store = storeWith(await stored(routine), "updateResource", () => Promise.reject(new Error("disk on fire")));
    const error = await errorOf(async () => {
      await newClearRoutinePauseStep(store).execute(resumeContext(routine));
    });
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to resume routine");
  });
});

describe("ClearRoutinePause — the no-op path's re-read", () => {
  it("answers NOT_FOUND naming the routine when it was deleted before the re-read", async () => {
    const routine = loaded(false);
    const store = storeWith(await stored(routine), "getResource", () =>
      Promise.reject(new ResourceNotFoundError(`routine ${ROUTINE_ID}`)),
    );
    const error = await errorOf(async () => {
      await newClearRoutinePauseStep(store).execute(resumeContext(routine));
    });
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain(ROUTINE_ID);
  });

  it("answers INTERNAL when the store cannot re-read the routine", async () => {
    const routine = loaded(false);
    const store = storeWith(await stored(routine), "getResource", () => Promise.reject(new Error("disk on fire")));
    const error = await errorOf(async () => {
      await newClearRoutinePauseStep(store).execute(resumeContext(routine));
    });
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to resume routine");
  });
});
