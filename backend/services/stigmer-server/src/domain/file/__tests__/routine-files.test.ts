/**
 * Pins the check a routine's named Files get when it is written
 * (../routine-files.ts), over the SQLite store:
 *   - a File of the routine's organization the writer may view passes;
 *   - a File that does not exist is NOT_FOUND, one of another
 *     organization FAILED_PRECONDITION, and one the writer may not view
 *     PERMISSION_DENIED;
 *   - on an update, a File the stored routine already named is not asked
 *     again; a newly named one is;
 *   - a routine naming no File asks nothing.
 * The composed routine chain runs it (routine.composed.test.ts).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newCheckRoutineFilesStep } from "../routine-files.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ORG = "org_01bbbbbbbbbbbbbbbbbbbbbbbb";
const CALLER = testCallerIdentity();

let fx: TempStore;
let asked: string[];

const allowing: Authorizer = {
  authorize: (_caller, request) => {
    asked.push(request.resourceId);
    return Promise.resolve({ kind: "allow" });
  },
};
const denying: Authorizer = {
  authorize: (_caller, request) => {
    asked.push(request.resourceId);
    return Promise.resolve({ kind: "deny", reason: "" });
  },
};

beforeEach(async () => {
  fx = tempStore();
  asked = [];
  for (const [id, org] of [
    ["file_01mine", ORG],
    ["file_01also", ORG],
    ["file_01theirs", OTHER_ORG],
  ] as const) {
    await fx.store.saveResource(
      ApiResourceKind.file,
      id,
      FileSchema,
      create(FileSchema, { metadata: { id, org, name: `${id}.txt` } }),
    );
  }
});

afterEach(async () => {
  await fx.cleanup();
});

function routineNaming(fileIds: string[]) {
  return create(RoutineSchema, {
    metadata: { id: "rtn_01files", org: ORG },
    spec: { agent: { resources: fileIds.map((fileId) => ({ resource: { case: "file" as const, value: { fileId } } })) } },
  });
}

async function check(fileIds: string[], authorizer: Authorizer, stored?: string[]): Promise<unknown> {
  const ctx = new RequestContext(RoutineSchema, routineNaming(fileIds), CALLER, ApiResourceKind.routine);
  if (stored !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, routineNaming(stored));
  }
  return Promise.resolve(newCheckRoutineFilesStep({ store: fx.store, authorizer }).execute(ctx)).then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe("a routine's named Files", () => {
  it("passes a File of the routine's organization the writer may view, asking once per File", async () => {
    expect(await check(["file_01mine", "file_01mine"], allowing)).toBeUndefined();
    expect(asked).toEqual(["file_01mine"]);
  });

  it("refuses a File that does not exist, one of another organization, and one the writer may not view", async () => {
    expect(((await check(["file_01nosuch"], allowing)) as ConnectError).code).toBe(Code.NotFound);
    expect(((await check(["file_01theirs"], allowing)) as ConnectError).code).toBe(Code.FailedPrecondition);
    expect(((await check(["file_01mine"], denying)) as ConnectError).code).toBe(Code.PermissionDenied);
  });

  it("answers INTERNAL when a File cannot be read", async () => {
    const store = new Proxy(fx.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return () => Promise.reject(new Error("database unreachable"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const ctx = new RequestContext(RoutineSchema, routineNaming(["file_01mine"]), CALLER, ApiResourceKind.routine);
    const error = await Promise.resolve(newCheckRoutineFilesStep({ store, authorizer: allowing }).execute(ctx)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("asks only about the Files an update newly names", async () => {
    expect(await check(["file_01mine", "file_01also"], allowing, ["file_01mine"])).toBeUndefined();
    expect(asked).toEqual(["file_01also"]);
    asked = [];
    expect(await check(["file_01mine"], denying, ["file_01mine"])).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("asks nothing of a routine naming no File", async () => {
    expect(await check([], denying)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
