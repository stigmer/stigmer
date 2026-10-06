/**
 * Pins pushFromRunArtifact's own refusals, the arms its handler runs before
 * it reads anything: no run blob store wired answers a sanitized Internal,
 * and an empty run_id, storage_key or org answers InvalidArgument naming
 * the field. On the composed server the protovalidate interceptor answers
 * the empty fields first (skill.test.ts pins that copy), so these arms are
 * reached here through the registered handler on an in-process router that
 * runs only the verifier chain and the apiresource interceptor.
 *
 * Every store and blob store is untouchable: a refused request must stop
 * before any read.
 */
import type { Client } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { errorOf, untouchable } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";

import { registerSkillServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function skillCommand(
  executionArtifactStorage: ArtifactStorage | undefined,
): Client<typeof SkillCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerSkillServices(router, {
        store: untouchable("store"),
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        artifactStorage: untouchable("artifactStorage"),
        executionArtifactStorage,
      });
    },
    {
      router: {
        interceptors: [
          createVerifierChainInterceptor([], [], silentLogger),
          createApiResourceInterceptor(),
        ],
      },
    },
  );
  return createClient(SkillCommandController, transport);
}

const COMPLETE = {
  runId: "aex_source",
  storageKey: "artifacts/aex_source/skill.zip",
  org: "acme",
};

describe("pushFromRunArtifact — the handler's own refusals", () => {
  it("answers a sanitized Internal when no run blob store is wired", async () => {
    const error = await errorOf(() =>
      skillCommand(undefined).pushFromRunArtifact(COMPLETE),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("execution artifact storage not configured");
  });

  it.each([
    ["run_id", { ...COMPLETE, runId: "" }],
    ["storage_key", { ...COMPLETE, storageKey: "" }],
    ["org", { ...COMPLETE, org: "" }],
  ])(
    "an empty %s answers InvalidArgument naming the field",
    async (field, request) => {
      const error = await errorOf(() =>
        skillCommand(
          untouchable<ArtifactStorage>("executionArtifactStorage"),
        ).pushFromRunArtifact(request),
      );

      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(`${field} is required`);
    },
  );
});
