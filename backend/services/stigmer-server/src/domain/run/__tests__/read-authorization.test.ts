/**
 * Pins the annotation enforcement on this domain's two config-annotated
 * direct read surfaces (getArtifactDownloadUrl, getArtifactContent): each
 * evaluates its OWN annotation through authorizeDirect, and a denying
 * authorizer answers PERMISSION_DENIED with the method's byte-pinned
 * error_msg — before any store or blob-storage touch. The exact copy doubles as the descriptor-mismatch
 * guard. The decision mapping itself is pinned in
 * pipeline/steps/__tests__/authorize.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  GetArtifactContentRequestSchema,
  GetArtifactDownloadUrlRequestSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";

import { getArtifactContent, getArtifactDownloadUrl } from "../artifacts.js";

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

const untouchableStorage = new Proxy({} as ArtifactStorage, {
  get(_target, prop) {
    throw new Error(`storage.${String(prop)} reached despite the denial`);
  },
});

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

describe("read-surface authorization", () => {
  it("getArtifactDownloadUrl denies with its annotation copy before the load", async () => {
    await expectDenied(
      () =>
        getArtifactDownloadUrl(
          artifactDeps,
          create(GetArtifactDownloadUrlRequestSchema, {
            runId: "aexec_01denied",
            storageKey: "artifacts/aexec_01denied/report.txt",
          }),
          testCallerIdentity(),
        ),
      "unauthorized to download artifact from run",
    );
  });

  it("getArtifactContent denies with its annotation copy before the ownership check", async () => {
    await expectDenied(
      () =>
        getArtifactContent(
          artifactDeps,
          create(GetArtifactContentRequestSchema, {
            runId: "aexec_01denied",
            storageKey: "artifacts/aexec_01denied/report.txt",
          }),
          testCallerIdentity(),
        ),
      "unauthorized to read artifact content from run",
    );
  });
});
