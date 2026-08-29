/**
 * Pins the C2 Stage-4 enforcement on this domain's three config-annotated
 * direct read surfaces (subscribe, subscribeEvents, getEventLog): each
 * evaluates its OWN annotation through authorizeDirect BEFORE any store
 * or broker touch, and a denying authorizer answers PERMISSION_DENIED
 * with the method's byte-pinned error_msg. The exact copy doubles as the
 * descriptor-mismatch guard (a handler passing another method's
 * descriptor would answer the wrong copy). The deny/not-found/unavailable
 * mapping itself is pinned in pipeline/steps/__tests__/authorize.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  GetEventLogRequestSchema,
  SubscribeEventsRequestSchema,
  SubscribeWorkflowExecutionRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";

import { getEventLog } from "../get-event-log.js";
import type { StreamBroker } from "../stream-broker.js";
import { subscribeEvents } from "../subscribe-events.js";
import { subscribeExecution } from "../subscribe.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const denyingAuthorizer: Authorizer = {
  authorize: () => Promise.resolve({ kind: "deny", reason: "" }),
};

/** A store that fails the test if the denied request ever reaches it. */
const untouchableStore = new Proxy({} as Store, {
  get(_target, prop) {
    throw new Error(`store.${String(prop)} reached despite the denial`);
  },
});

const untouchableBroker = new Proxy({} as StreamBroker, {
  get(_target, prop) {
    throw new Error(`broker.${String(prop)} reached despite the denial`);
  },
});

function handlerContext(): HandlerContext {
  const values = createContextValues();
  values.set(callerIdentityKey, testCallerIdentity());
  return { signal: new AbortController().signal, values } as HandlerContext;
}

async function expectDenied(run: () => Promise<unknown>, copy: string) {
  const error = await run().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(Code.PermissionDenied);
  expect((error as ConnectError).rawMessage).toBe(copy);
}

describe("read-surface authorization (C2 Stage 4)", () => {
  it("subscribe denies with its annotation copy before touching store or broker", async () => {
    await expectDenied(
      () =>
        subscribeExecution(
          {
            store: untouchableStore,
            logger: silentLogger,
            broker: untouchableBroker,
            authorizer: denyingAuthorizer,
          },
          create(SubscribeWorkflowExecutionRequestSchema, {
            executionId: "wfe_01denied",
          }),
          handlerContext(),
        ).next(),
      "unauthorized to get workflow execution stream",
    );
  });

  it("subscribeEvents denies with its annotation copy before the existence check", async () => {
    await expectDenied(
      () =>
        subscribeEvents(
          {
            store: untouchableStore,
            logger: silentLogger,
            authorizer: denyingAuthorizer,
          },
          create(SubscribeEventsRequestSchema, { executionId: "wfe_01denied" }),
          handlerContext(),
        ).next(),
      "unauthorized to subscribe to workflow execution events",
    );
  });

  it("getEventLog denies with its annotation copy before the store read", async () => {
    await expectDenied(
      () =>
        getEventLog(
          {
            store: untouchableStore,
            logger: silentLogger,
            authorizer: denyingAuthorizer,
          },
          create(GetEventLogRequestSchema, { executionId: "wfe_01denied" }),
          testCallerIdentity(),
        ),
      "unauthorized to get workflow execution event log",
    );
  });

  it("the internal caller class skips the check on all three (in-process parity)", async () => {
    // The denying authorizer must never be consulted; the handlers then
    // proceed into their store reads — the throwing store proves BOTH.
    const internal = testCallerIdentity({ callerClass: "internal" });
    const values = createContextValues();
    values.set(callerIdentityKey, internal);
    const ctx = {
      signal: new AbortController().signal,
      values,
    } as HandlerContext;

    const subscribeError = await subscribeExecution(
      {
        store: untouchableStore,
        logger: silentLogger,
        broker: untouchableBroker,
        authorizer: denyingAuthorizer,
      },
      create(SubscribeWorkflowExecutionRequestSchema, {
        executionId: "wfe_01internal",
      }),
      ctx,
    )
      .next()
      .catch((e: unknown) => e);
    expect((subscribeError as Error).message).toContain(
      "reached despite the denial",
    );

    // getEventLog wraps its store fault as the sanitized Internal — the
    // wrapped copy (not a denial) is the store-was-reached proof.
    const eventLogError = await getEventLog(
      {
        store: untouchableStore,
        logger: silentLogger,
        authorizer: denyingAuthorizer,
      },
      create(GetEventLogRequestSchema, { executionId: "wfe_01internal" }),
      internal,
    ).catch((e: unknown) => e);
    expect((eventLogError as ConnectError).code).toBe(Code.Internal);
    expect((eventLogError as ConnectError).rawMessage).toBe(
      "failed to query execution events",
    );
  });
});
