/**
 * Pins whose address an eval download link is signed for, over the R2
 * driver with a runner address of its own (a self-host or a local stack
 * whose sandboxes reach the bucket elsewhere than people do): the public
 * getDownloadUrl, which the CLI's `download eval` and the SDK ask, signs
 * for a person, so the link resolves on the person's machine
 * (stigmer#2364); the runner's eval-case door signs for the runner, so a
 * sandbox's case fetch keeps working. Signing is local SigV4, so no call
 * leaves the host; the archive store is a stub that holds every digest.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalQueryController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/query_pb";
import { GetRunEvalCaseArchiveInputSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { R2ArtifactStorage } from "../../../artifactstorage/r2-storage.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../authorization/__tests__/unbound-credential-binding.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newArchiveStaging } from "../../skill/transfer/staging.js";
import { registerEvalServices } from "../controller.js";
import { getRunEvalCaseArchiveDownloadUrl } from "../run-case.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const EVAL_ID = "evs_01linkslinkslinkslinkslin";
const DIGEST = "d".repeat(64);
const BUCKET = "stigmer-artifacts";
const PERSON_ENDPOINT = "https://accountid.r2.cloudflarestorage.com";
const RUNNER_ENDPOINT = "http://host.docker.internal:9000";

const bucket = new R2ArtifactStorage({
  bucket: BUCKET,
  endpoint: PERSON_ENDPOINT,
  runnerEndpoint: RUNNER_ENDPOINT,
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "auto",
});

/** An archive store that holds every digest, one byte each. */
const archives: ContentAddressedArchiveStore = {
  store: (hash) => Promise.resolve(`evals/${hash}.zip`),
  get: () => Promise.resolve(new Uint8Array([1])),
  exists: () => Promise.resolve(true),
  size: () => Promise.resolve(1),
  getStorageKey: (hash) => `evals/${hash}.zip`,
};

let fx: TempStore;

beforeEach(async () => {
  fx = tempStore();
  await fx.store.saveResource(
    ApiResourceKind.eval,
    EVAL_ID,
    EvalSchema,
    create(EvalSchema, { metadata: { id: EVAL_ID, org: ORG, slug: "links" }, status: { digest: DIGEST } }),
  );
});

afterEach(async () => {
  await fx.cleanup();
});

describe("an eval's download links", () => {
  it("signs the public getDownloadUrl for a person's address", async () => {
    const transport = createRouterTransport(
      (router) => {
        registerEvalServices(router, {
          store: fx.store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          authorizationLifecycle: undefined,
          listReadScope: undefined,
          artifactStorage: archives,
          staging: newArchiveStaging(bucket, silentLogger),
          credentialBinding: UNBOUND_CREDENTIAL_BINDING,
        });
      },
      {
        router: {
          interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
        },
      },
    );
    const link = await createClient(EvalQueryController, transport).getDownloadUrl({
      kind: ApiResourceKind.eval,
      id: EVAL_ID,
      version: DIGEST,
    });
    expect(link.url.split("?")[0]).toBe(`${PERSON_ENDPOINT}/${BUCKET}/evals/${DIGEST}.zip`);
    expect(link.digest).toBe(DIGEST);
  });

  it("signs the runner's eval-case door for the runner's address", async () => {
    const auth = RunnerAuthService.create(randomBytes(32));
    await fx.store.saveResource(
      ApiResourceKind.run,
      "run_01links",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_01links", org: ORG },
        spec: { evalCase: { evalId: EVAL_ID, evalDigest: DIGEST } },
        status: { phase: RunPhase.RUN_IN_PROGRESS },
      }),
    );
    const link = await getRunEvalCaseArchiveDownloadUrl(
      {
        store: fx.store,
        logger: silentLogger,
        runnerAuth: newExecutionScopedRunnerCredentialProvider(auth),
        artifactStorage: archives,
        staging: newArchiveStaging(bucket, silentLogger),
      },
      create(GetRunEvalCaseArchiveInputSchema, { runId: "run_01links" }),
      {
        requestHeader: new Headers({ authorization: `Bearer ${auth.mintRunCredential("run_01links")}` }),
      } as unknown as HandlerContext,
    );
    expect(link.url.split("?")[0]).toBe(`${RUNNER_ENDPOINT}/${BUCKET}/evals/${DIGEST}.zip`);
  });
});
