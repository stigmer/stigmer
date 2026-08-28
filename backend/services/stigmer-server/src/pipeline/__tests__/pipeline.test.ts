/**
 * Pins the pipeline executor's contract (Go pipeline.go / error.go):
 * ordered execution, halt-on-first-error, and the #478 wire sanitization —
 * a ConnectError passes through with its clean domain message; a plain
 * error reaches the wire as Internal/"internal server error" with the real
 * cause kept server-side. Also pins RequestContext's input immutability.
 */
import { testCallerIdentity } from "./support.js";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { create } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import { INTERNAL_FALLBACK_MESSAGE, newPipeline } from "../pipeline.js";
import type { PipelineStep } from "../pipeline.js";
import { LOADED_EXECUTION_KEY, RequestContext } from "../request-context.js";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function orgContext(): RequestContext<typeof OrganizationSchema> {
  return new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, {
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "Acme" },
    }),
    testCallerIdentity(),
  );
}

function step(
  name: string,
  fn: (order: string[]) => void,
  order: string[],
): PipelineStep<typeof OrganizationSchema> {
  return {
    name,
    execute() {
      fn(order);
    },
  };
}

describe("pipeline execution", () => {
  it("runs steps in order and stops on the first error", async () => {
    const order: string[] = [];
    const pipeline = newPipeline<typeof OrganizationSchema>(
      "test",
      silentLogger,
    )
      .addStep(step("First", (o) => o.push("first"), order))
      .addStep({
        name: "Boom",
        execute() {
          throw new ConnectError("nope", Code.FailedPrecondition);
        },
      })
      .addStep(step("Never", (o) => o.push("never"), order))
      .build();

    await expect(pipeline.execute(orgContext())).rejects.toThrow("nope");
    expect(order).toEqual(["first"]);
  });

  it("preserves a ConnectError's code and clean message on the wire", async () => {
    const pipeline = newPipeline<typeof OrganizationSchema>(
      "test",
      silentLogger,
    )
      .addStep({
        name: "Reject",
        execute() {
          throw new ConnectError(
            "Organization already exists: slug 'acme'",
            Code.AlreadyExists,
          );
        },
      })
      .build();

    const error = await pipeline.execute(orgContext()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.AlreadyExists);
    // No "pipeline step X failed" prefix reaches the wire (Go GRPCStatus).
    expect((error as ConnectError).rawMessage).toBe(
      "Organization already exists: slug 'acme'",
    );
  });

  it("sanitizes a plain error to Internal/'internal server error' with the cause kept server-side (#478)", async () => {
    const raw = new Error(
      "SQLITE_IOERR: /home/user/.stigmer/stigmer.db is corrupt",
    );
    const pipeline = newPipeline<typeof OrganizationSchema>(
      "test",
      silentLogger,
    )
      .addStep({
        name: "Leaky",
        execute() {
          throw raw;
        },
      })
      .build();

    const error = await pipeline.execute(orgContext()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe(INTERNAL_FALLBACK_MESSAGE);
    expect((error as ConnectError).rawMessage).not.toContain("stigmer.db");
    expect((error as ConnectError).cause).toBe(raw);
  });
});

describe("RequestContext", () => {
  it("clones the input into newState so steps never mutate the request", () => {
    const ctx = orgContext();
    ctx.newState.metadata!.slug = "mutated";
    expect(ctx.input.metadata?.slug).toBe("");
    expect(ctx.newState.metadata?.slug).toBe("mutated");
  });

  it("passes inter-step values by key", () => {
    const ctx = orgContext();
    expect(ctx.get("missing")).toBeUndefined();
    ctx.set("shouldCreate", true);
    expect(ctx.get("shouldCreate")).toBe(true);
  });

  it("pins the loaded-execution context key (C4 Stage 3): both lifecycle chains stamp it and extension gate steps read it", () => {
    expect(LOADED_EXECUTION_KEY).toBe("loadedExecution");
  });
});
