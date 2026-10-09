/**
 * Pins who may rate and read a run's scores over a real boot under the
 * BUILT-IN posture (a unit that declares require-authentication and
 * registers no Authorizer: the open-source self-host with sign-in), with
 * two signed-in people of one organization:
 *
 *   - Carol rates her own completed run, through her sign-in and through
 *     her own API key, and changes her rating: a rating is owned by the
 *     person whose creator stamp it carries, whichever credential they
 *     used;
 *   - Dave, a member who cannot see Carol's private conversation, can
 *     neither rate her run nor read, change or delete its scores; a run
 *     that does not exist answers him NOT_FOUND, as the run's own `get`
 *     does;
 *   - deleting the run removes its scores.
 *
 * The run is stored directly, completed, in a session Carol created
 * through its RPC (no engine runs here).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { generateId } from "../../../pipeline/steps/defaults.js";
import { SCORE_CREATE_DENIED_MESSAGE } from "../constants.js";

const CAROL = "fake|carol";
const DAVE = "fake|dave";
const ORG = "score-authorization-org";

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

describe("scores where callers are persons (built-in posture, composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgId: string;
  let sessionId: string;
  let carolKey: string;

  const asCarol = () => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = () => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  function feedback(runId: string, passed: boolean) {
    return create(ScoreSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Score",
      metadata: { org: ORG },
      spec: {
        runId,
        metric: "feedback",
        source: ScoreSource.human,
        value: { case: "passed", value: passed },
      },
    });
  }

  /** A completed run in Carol's session, stored as an engine leaves it. */
  async function completedRun(): Promise<string> {
    const runId = generateId("run");
    await server.store.saveResource(
      ApiResourceKind.run,
      runId,
      RunSchema,
      create(RunSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Run",
        metadata: { id: runId, name: runId, slug: runId, org: orgId },
        spec: { target: { case: "sessionId", value: sessionId } },
        status: { phase: RunPhase.RUN_COMPLETED },
      }),
    );
    return runId;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "score-authorization-composed-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();

    await createClient(
      IdentityAccountCommandController,
      asCarol(),
    ).provisionMyAccount({});
    const org = await createClient(
      OrganizationCommandController,
      asCarol(),
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    orgId = org.metadata!.id;
    await createClient(
      IdentityAccountCommandController,
      asDave(),
    ).provisionMyAccount({});

    const session = await createClient(
      SessionCommandController,
      asCarol(),
    ).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name: "carols-chat", org: ORG },
      spec: {},
    });
    sessionId = session.metadata!.id;

    const key = await createClient(ApiKeyCommandController, asCarol()).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "carols key", org: ORG },
      spec: {},
    });
    carolKey = key.spec?.keyHash ?? "";
    expect(carolKey).not.toBe("");
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a person rates their own run with their sign-in and changes the rating", async () => {
    const runId = await completedRun();
    const command = createClient(ScoreCommandController, asCarol());
    const rated = await command.create(feedback(runId, true));
    const edited = create(ScoreSchema, rated);
    edited.spec!.value = { case: "passed", value: false };
    const changed = await command.update(edited);
    expect(changed.spec?.value).toEqual({ case: "passed", value: false });
  });

  it("a person rates with their own API key, and the rating is theirs", async () => {
    const runId = await completedRun();
    const viaKey = await createClient(
      ScoreCommandController,
      transportFor(port, carolKey),
    ).create(feedback(runId, true));
    // The same person, signed in, owns it.
    const edited = create(ScoreSchema, viaKey);
    edited.spec!.comment = "changed from the console";
    const changed = await createClient(
      ScoreCommandController,
      asCarol(),
    ).update(edited);
    expect(changed.spec?.comment).toBe("changed from the console");
  });

  it("a member who cannot see the run can neither rate it nor touch its scores", async () => {
    const runId = await completedRun();
    const rated = await createClient(ScoreCommandController, asCarol()).create(
      feedback(runId, true),
    );
    const daveCommand = createClient(ScoreCommandController, asDave());
    const daveQuery = createClient(ScoreQueryController, asDave());

    const refused = await failureOf(daveCommand.create(feedback(runId, false)));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(SCORE_CREATE_DENIED_MESSAGE);
    expect((await failureOf(daveQuery.listByRun({ runId }))).code).toBe(
      Code.PermissionDenied,
    );
    expect((await failureOf(daveQuery.listBySession({ sessionId }))).code).toBe(
      Code.PermissionDenied,
    );
    expect(
      (await failureOf(daveQuery.get({ value: rated.metadata!.id }))).code,
    ).toBe(Code.PermissionDenied);
    expect((await failureOf(daveCommand.update(rated))).code).toBe(
      Code.PermissionDenied,
    );
    expect(
      (await failureOf(daveCommand.delete({ value: rated.metadata!.id }))).code,
    ).toBe(Code.PermissionDenied);
  });

  it("a run that does not exist answers NOT_FOUND, as the run's own get does", async () => {
    const missing = generateId("run");
    const failure = await failureOf(
      createClient(ScoreCommandController, asDave()).create(
        feedback(missing, true),
      ),
    );
    expect(failure.code).toBe(Code.NotFound);
  });

  it("deleting the run removes its scores", async () => {
    const runId = await completedRun();
    const rated = await createClient(ScoreCommandController, asCarol()).create(
      feedback(runId, true),
    );
    await createClient(RunCommandController, asCarol()).delete({
      value: runId,
    });
    expect(
      (
        await failureOf(
          createClient(ScoreQueryController, asCarol()).get({
            value: rated.metadata!.id,
          }),
        )
      ).code,
    ).toBe(Code.NotFound);
  });
});
