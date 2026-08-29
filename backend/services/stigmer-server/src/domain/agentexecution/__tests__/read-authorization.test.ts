/**
 * Pins the C2 Stage-4 enforcement on this domain's three config-annotated
 * direct read surfaces (subscribe, getArtifactDownloadUrl,
 * getArtifactContent): each evaluates its OWN annotation through
 * authorizeDirect, and a denying authorizer answers PERMISSION_DENIED
 * with the method's byte-pinned error_msg — before any store, broker, or
 * blob-storage touch. The exact copy doubles as the descriptor-mismatch
 * guard. The decision mapping itself is pinned in
 * pipeline/steps/__tests__/authorize.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  AgentExecutionIdSchema,
  GetArtifactContentRequestSchema,
  GetArtifactDownloadUrlRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";

import { getArtifactContent, getArtifactDownloadUrl } from "../artifacts.js";
import type { StreamBroker } from "../stream-broker.js";
import { subscribeExecution } from "../subscribe.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const denyingAuthorizer: Authorizer = {
  authorize: () => Promise.resolve({ kind: "deny", reason: "" }),
};

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

const untouchableStorage = new Proxy({} as ArtifactStorage, {
  get(_target, prop) {
    throw new Error(`storage.${String(prop)} reached despite the denial`);
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

const artifactDeps = {
  store: untouchableStore,
  logger: silentLogger,
  artifactStorage: untouchableStorage,
  authorizer: denyingAuthorizer,
};

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
          create(AgentExecutionIdSchema, { value: "aexec_01denied" }),
          handlerContext(),
        ).next(),
      "unauthorized to subscribe to agent execution",
    );
  });

  it("getArtifactDownloadUrl denies with its annotation copy before the load", async () => {
    await expectDenied(
      () =>
        getArtifactDownloadUrl(
          artifactDeps,
          create(GetArtifactDownloadUrlRequestSchema, {
            executionId: "aexec_01denied",
            storageKey: "artifacts/aexec_01denied/report.txt",
          }),
          testCallerIdentity(),
        ),
      "unauthorized to download artifact from agent execution",
    );
  });

  it("getArtifactContent denies with its annotation copy before the ownership check", async () => {
    await expectDenied(
      () =>
        getArtifactContent(
          artifactDeps,
          create(GetArtifactContentRequestSchema, {
            executionId: "aexec_01denied",
            storageKey: "artifacts/aexec_01denied/report.txt",
          }),
          testCallerIdentity(),
        ),
      "unauthorized to read artifact content from agent execution",
    );
  });
});
