/**
 * Pins how the File domain's delete steps and failure helpers answer a
 * store or a copy that fails, over stub stores:
 *   - the routine guard answers INTERNAL when it cannot read the routines;
 *   - taking a File out of its conversation is done when the conversation
 *     is gone, and INTERNAL when the store fails otherwise;
 *   - runIsStored reads a stored run as stored, a missing one (or none
 *     named) as not, and a fault as stored, so nothing is taken back on a
 *     guess;
 *   - discardQuietly logs a copy it could not remove and raises nothing.
 * Their working paths run in session-resources.test.ts and
 * message-files.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { discardQuietly } from "../instances.js";
import type { FileInstances } from "../instances.js";
import { runIsStored } from "../message-files.js";
import { newGuardFileUnreferencedStep, newRemoveFromConversationStep } from "../steps.js";

const CALLER = testCallerIdentity();
const DeleteInput = FileCommandController.method.delete.input;

function deleteContext(sessionId: string): RequestContext<typeof DeleteInput> {
  const ctx = new RequestContext(DeleteInput, create(DeleteInput, { value: "file_01gone" }), CALLER, ApiResourceKind.file);
  ctx.set(
    EXISTING_RESOURCE_KEY,
    create(FileSchema, { metadata: { id: "file_01gone", org: "org_01a" }, status: { sessionId } }),
  );
  return ctx;
}

function stubStore(methods: Partial<Store>): Store {
  return methods as Store;
}

async function refusal(work: Promise<unknown> | unknown): Promise<ConnectError> {
  const error = await Promise.resolve(work).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("the File delete steps when the store fails", () => {
  it("the routine guard answers INTERNAL when the routines cannot be read", async () => {
    const store = stubStore({ queryResources: () => Promise.reject(new Error("database unreachable")) });
    const error = await refusal(newGuardFileUnreferencedStep(store).execute(deleteContext("")));
    expect(error.code).toBe(Code.Internal);
  });

  it("taking the File out of a conversation that is gone does nothing", async () => {
    const store = stubStore({
      updateResource: () => Promise.reject(new ResourceNotFoundError("session ses_01gone")),
    });
    await expect(newRemoveFromConversationStep(store).execute(deleteContext("ses_01gone"))).resolves.toBeUndefined();
  });

  it("taking the File out of its conversation answers INTERNAL on any other fault", async () => {
    const store = stubStore({ updateResource: () => Promise.reject(new Error("database unreachable")) });
    const error = await refusal(newRemoveFromConversationStep(store).execute(deleteContext("ses_01held")));
    expect(error.code).toBe(Code.Internal);
  });
});

describe("runIsStored", () => {
  it("reads a stored run as stored, a missing or unnamed one as not, and a fault as stored", async () => {
    const stored = stubStore({ getResource: (() => Promise.resolve({})) as unknown as Store["getResource"] });
    const missing = stubStore({
      getResource: () => Promise.reject(new ResourceNotFoundError("run run_01x")),
    });
    const faulty = stubStore({ getResource: () => Promise.reject(new Error("database unreachable")) });
    expect(await runIsStored(stored, "run_01x")).toBe(true);
    expect(await runIsStored(missing, "run_01x")).toBe(false);
    expect(await runIsStored(stored, "")).toBe(false);
    expect(await runIsStored(faulty, "run_01x")).toBe(true);
  });
});

describe("discardQuietly", () => {
  it("logs a copy it could not remove and raises nothing", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", pretty: false, write: (line) => lines.push(line) });
    const instances: FileInstances = {
      resolve: () => Promise.reject(new Error("not used")),
      discard: () => Promise.reject(new Error("blob store unreachable")),
      made: new Map(),
    };
    await expect(discardQuietly(instances, CALLER, logger)).resolves.toBeUndefined();
    expect(lines.join("\n")).toContain("blob store unreachable");
  });
});
