/**
 * Pins the runner's eval-case door (../run-case.ts, registered by
 * ../run-eval-case.ts) over the SQLite store, a real runner credential
 * service and a recording staging port:
 *   - the runner acting for the run gets a link to the archive of the
 *     Eval version its run's case names, signed for the runner, with the
 *     archive's size and digest; the spec's version is answered even when
 *     the Eval has moved past it; served through the registered service as
 *     through the handler;
 *   - no bearer, garbage, another run's credential, a run nobody holds and
 *     a composed decision that refuses are each the one PERMISSION_DENIED;
 *   - a finished run, a run with no eval case, a run whose case is a
 *     plugin's, and a server with no transfer lane are FAILED_PRECONDITION;
 *     a run_id is required;
 *   - a missing Eval, version or archive is NOT_FOUND, as on the public
 *     getDownloadUrl; a store fault reading the run, or an archive fault
 *     other than missing, is INTERNAL.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import type { EvalArchiveDownloadUrl } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import { GetRunEvalCaseArchiveInputSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";
import type { GetRunEvalCaseArchiveInput } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { EvalCaseContextSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ArtifactNotFoundError } from "../../../archive/content-store.js";
import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import type { SignedUrlReader } from "../../../artifactstorage/artifact-storage.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import type { ArchiveStaging } from "../../skill/transfer/staging.js";
import { EVAL_TRANSFER_LANE_NOT_CONFIGURED, RUN_EVAL_CASE_NOT_THE_RUNS_RUNNER } from "../constants.js";
import { getRunEvalCaseArchiveDownloadUrl } from "../run-case.js";
import type { RunEvalCaseDeps } from "../run-case.js";
import { registerRunEvalCaseService } from "../run-eval-case.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const EVAL_ID = "evs_01casecasecasecasecasecas";
const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

let fx: TempStore;
let auth: RunnerAuthService;
let credentials: RunnerCredentialProvider;
let signed: Array<{ readonly key: string; readonly reader: SignedUrlReader }>;

/** A staging port that records what it signs and answers a URL naming the key and reader. */
function recordingStaging(): ArchiveStaging {
  return {
    mint: () => Promise.reject(new Error("not used")),
    consume: () => Promise.reject(new Error("not used")),
    downloadUrl: (key, reader) => {
      signed.push({ key, reader });
      return Promise.resolve({ url: `https://${reader}.test/${key}`, ttlMs: 3_600_000 });
    },
  };
}

/** An archive store holding every digest at 42 bytes, or failing every read with `fault`. */
function archives(fault?: () => Error): ContentAddressedArchiveStore {
  const fail = (): Promise<never> => Promise.reject(fault!());
  return {
    store: (hash) => Promise.resolve(`evals/${hash}.zip`),
    get: () => (fault === undefined ? Promise.resolve(new Uint8Array([1])) : fail()),
    exists: () => (fault === undefined ? Promise.resolve(true) : fail()),
    size: () => (fault === undefined ? Promise.resolve(42) : fail()),
    getStorageKey: (hash) => `evals/${hash}.zip`,
  };
}

beforeAll(() => {
  auth = RunnerAuthService.create(randomBytes(32));
  credentials = newExecutionScopedRunnerCredentialProvider(auth);
});

beforeEach(async () => {
  fx = tempStore();
  signed = [];
  // The Eval moved past OLD: NEW is its head, OLD an archived version.
  const at = (digest: string) =>
    create(EvalSchema, { metadata: { id: EVAL_ID, org: ORG, slug: "cases" }, status: { digest } });
  await fx.store.saveResource(ApiResourceKind.eval, EVAL_ID, EvalSchema, at(NEW));
  await fx.store.saveAudit(ApiResourceKind.eval, EVAL_ID, EvalSchema, at(OLD), OLD, "");
});

afterEach(async () => {
  await fx.cleanup();
});

function deps(overrides: Partial<RunEvalCaseDeps> = {}): RunEvalCaseDeps {
  return {
    store: fx.store,
    logger: silentLogger,
    runnerAuth: credentials,
    artifactStorage: archives(),
    staging: recordingStaging(),
    ...overrides,
  };
}

function bearer(token: string): HandlerContext {
  return { requestHeader: new Headers(token === "" ? {} : { authorization: `Bearer ${token}` }) } as unknown as HandlerContext;
}

async function seedRun(
  runId: string,
  evalCase: MessageInitShape<typeof EvalCaseContextSchema> | undefined,
  phase = RunPhase.RUN_IN_PROGRESS,
): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    create(RunSchema, {
      metadata: { id: runId, org: ORG },
      spec: evalCase === undefined ? {} : { evalCase: create(EvalCaseContextSchema, evalCase) },
      status: { phase },
    }),
  );
}

function ask(runId: string, token: string, overrides: Partial<RunEvalCaseDeps> = {}) {
  return getRunEvalCaseArchiveDownloadUrl(deps(overrides), create(GetRunEvalCaseArchiveInputSchema, { runId }), bearer(token));
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("RunEvalCaseController.getArchiveDownloadUrl", () => {
  it("hands the run's runner a link to the version its case names, signed for the runner, though the Eval moved on", async () => {
    await seedRun("run_01case", { evalId: EVAL_ID, evalDigest: OLD });
    const link = await ask("run_01case", auth.mintRunCredential("run_01case"));
    expect(link.url).toBe(`https://runner.test/evals/${OLD}.zip`);
    expect(link.digest).toBe(OLD);
    expect(link.sizeBytes).toBe(42n);
    expect(link.ttlSeconds).toBe(3600);
    expect(signed).toEqual([{ key: `evals/${OLD}.zip`, reader: "runner" }]);
  });

  it("answers through the registered service as through the handler", async () => {
    await seedRun("run_01case", { evalId: EVAL_ID, evalDigest: NEW });
    let served:
      | { getArchiveDownloadUrl: (input: GetRunEvalCaseArchiveInput, ctx: HandlerContext) => Promise<EvalArchiveDownloadUrl> }
      | undefined;
    const router = {
      service: (_service: unknown, implementation: typeof served) => {
        served = implementation;
        return router;
      },
    } as unknown as ConnectRouter;
    registerRunEvalCaseService(router, deps());
    const link = await served!.getArchiveDownloadUrl(
      create(GetRunEvalCaseArchiveInputSchema, { runId: "run_01case" }),
      bearer(auth.mintRunCredential("run_01case")),
    );
    expect(link.digest).toBe(NEW);
  });

  it("refuses everyone but the run's runner with the one PERMISSION_DENIED", async () => {
    await seedRun("run_01case", { evalId: EVAL_ID, evalDigest: OLD });
    await seedRun("run_01other", { evalId: EVAL_ID, evalDigest: OLD });
    for (const token of ["", "garbage", auth.mintRunCredential("run_01other")]) {
      const error = await refusal(ask("run_01case", token));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(RUN_EVAL_CASE_NOT_THE_RUNS_RUNNER);
    }
    const nobody = await refusal(ask("run_01nobody", auth.mintRunCredential("run_01nobody")));
    expect(nobody.code).toBe(Code.PermissionDenied);
    const composed: RunnerCredentialProvider = { ...credentials, authorizeRunnerForRun: async () => false };
    const refused = await refusal(ask("run_01case", auth.mintRunCredential("run_01case"), { runnerAuth: composed }));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(signed).toEqual([]);
  });

  it("refuses a finished run, a run with no eval case or a plugin's, no transfer lane, and a run_id left out", async () => {
    await seedRun("run_01done", { evalId: EVAL_ID, evalDigest: OLD }, RunPhase.RUN_COMPLETED);
    await seedRun("run_01plain", undefined);
    await seedRun("run_01plugin", { pluginId: "plg_01x", pluginDigest: OLD, suiteDir: "evals" });
    await seedRun("run_01case", { evalId: EVAL_ID, evalDigest: OLD });
    for (const runId of ["run_01done", "run_01plain", "run_01plugin"]) {
      const error = await refusal(ask(runId, auth.mintRunCredential(runId)));
      expect(error.code, runId).toBe(Code.FailedPrecondition);
    }
    const laneless = await refusal(ask("run_01case", auth.mintRunCredential("run_01case"), { staging: undefined }));
    expect(laneless.code).toBe(Code.FailedPrecondition);
    expect(laneless.rawMessage).toBe(EVAL_TRANSFER_LANE_NOT_CONFIGURED);
    expect((await refusal(ask("", "x"))).code).toBe(Code.InvalidArgument);
  });

  it("answers a missing Eval, version or archive as NOT_FOUND", async () => {
    await seedRun("run_01gone", { evalId: "evs_01gonegonegonegonegonego", evalDigest: OLD });
    await seedRun("run_01noversion", { evalId: EVAL_ID, evalDigest: "c".repeat(64) });
    await seedRun("run_01case", { evalId: EVAL_ID, evalDigest: OLD });
    for (const runId of ["run_01gone", "run_01noversion"]) {
      expect((await refusal(ask(runId, auth.mintRunCredential(runId)))).code, runId).toBe(Code.NotFound);
    }
    const missing = archives(() => new ArtifactNotFoundError(`evals/${OLD}.zip`));
    const noArchive = await refusal(ask("run_01case", auth.mintRunCredential("run_01case"), { artifactStorage: missing }));
    expect(noArchive.code).toBe(Code.NotFound);
  });

  it("answers INTERNAL when the run cannot be read or the archive store fails", async () => {
    await seedRun("run_01case", { evalId: EVAL_ID, evalDigest: OLD });
    const store = new Proxy(fx.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return (asked: ApiResourceKind, ...rest: unknown[]) =>
            asked === ApiResourceKind.run
              ? Promise.reject(new Error("database unreachable"))
              : (target.getResource as (...args: unknown[]) => Promise<unknown>).call(target, asked, ...rest);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const token = auth.mintRunCredential("run_01case");
    expect((await refusal(ask("run_01case", token, { store }))).code).toBe(Code.Internal);
    const broken = archives(() => new Error("EIO"));
    expect((await refusal(ask("run_01case", token, { artifactStorage: broken }))).code).toBe(Code.Internal);
  });
});
