/**
 * Pins who reads an agent's quality, and over whose runs, on a real boot
 * under the BUILT-IN posture (require-authentication, no unit Authorizer:
 * the open-source self-host with sign-in), with two people of one
 * organization, Carol and Dave, each with a private conversation of one
 * shared agent:
 *
 *   - the report counts both people's runs for either reader, though
 *     neither can open the other's conversation, and quotes neither;
 *   - each person's flagged list holds their own failed grades only: the
 *     list read scope is asked about the scores' sessions;
 *   - an agent the reader cannot view is refused before any row is read,
 *     and an agent that does not exist answers NOT_FOUND;
 *   - a person introducing the reserved eval label on a rating is refused
 *     by the reserved-label guard, as before the server stamped it.
 *
 * Runs are stored directly, completed, in sessions each person created
 * through its RPC (no engine runs here).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toJsonString } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { AgentQualityReportSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
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
import { PLUGIN_EVAL_LABEL } from "../../plugin-eval/constants.js";

const CAROL = "fake|carol";
const DAVE = "fake|dave";
const ORG = "score-quality-org";

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

describe("an agent's quality where callers are persons (built-in posture, composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgId: string;
  let agentId: string;
  let privateAgentId: string;
  let carolRun: string;
  let daveRun: string;

  const asCarol = () => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = () => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  function thumbsDown(runId: string, labels: Record<string, string> = {}) {
    return create(ScoreSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Score",
      metadata: { org: ORG, labels },
      spec: {
        runId,
        metric: "feedback",
        source: ScoreSource.human,
        value: { case: "passed", value: false },
        comment: "the answer was wrong",
      },
    });
  }

  /** A completed run of the shared agent in a session `as` creates. */
  async function runOf(as: () => Transport, name: string): Promise<string> {
    const session = await createClient(SessionCommandController, as()).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name, org: ORG },
      spec: {},
    });
    const runId = generateId("run");
    await server.store.saveResource(
      ApiResourceKind.run,
      runId,
      RunSchema,
      create(RunSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Run",
        metadata: { id: runId, name: runId, slug: runId, org: orgId },
        spec: {
          target: { case: "sessionId", value: session.metadata!.id },
        },
        status: {
          phase: RunPhase.RUN_COMPLETED,
          agentId,
          agentVersionHash: "hash-shared",
        },
      }),
    );
    return runId;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "score-quality-authorization-"));
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

    // Carol founds the organization; Dave provisions afterwards and is a
    // member of it (the membership rules run at a person's first
    // provisioning).
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

    const agents = createClient(AgentCommandController, asCarol());
    const shared = await agents.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: {
        name: "Support desk",
        org: ORG,
        slug: "support-desk",
        visibility: ApiResourceVisibility.visibility_org,
      },
      spec: { instructions: "answer support questions" },
    });
    agentId = shared.metadata!.id;
    const mine = await agents.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: {
        name: "Carol's drafts",
        org: ORG,
        slug: "carols-drafts",
        visibility: ApiResourceVisibility.visibility_private,
      },
      spec: { instructions: "draft replies" },
    });
    privateAgentId = mine.metadata!.id;

    carolRun = await runOf(asCarol, "carols-chat");
    daveRun = await runOf(asDave, "daves-chat");
    await createClient(ScoreCommandController, asCarol()).create(
      thumbsDown(carolRun),
    );
    await createClient(ScoreCommandController, asDave()).create(
      thumbsDown(daveRun),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts both people's runs for either reader, and quotes neither", async () => {
    for (const as of [asCarol, asDave]) {
      const report = await createClient(
        ScoreQueryController,
        as(),
      ).getAgentQualityReport({ org: ORG, agentId });
      expect(report.total?.runs).toBe(2);
      const thumbs = report.total?.metrics.find((m) => m.metric === "feedback");
      expect(thumbs?.failed).toBe(2);
      expect(toJsonString(AgentQualityReportSchema, report)).not.toContain(
        "wrong",
      );
    }
  });

  it("lists each person's own failed grades only", async () => {
    const carols = await createClient(
      ScoreQueryController,
      asCarol(),
    ).listFlaggedByAgent({ org: ORG, agentId });
    expect(carols.entries.map((s) => s.spec?.runId)).toEqual([carolRun]);
    const daves = await createClient(
      ScoreQueryController,
      asDave(),
    ).listFlaggedByAgent({ org: ORG, agentId });
    expect(daves.entries.map((s) => s.spec?.runId)).toEqual([daveRun]);
  });

  it("refuses an agent the reader cannot view, and answers NOT_FOUND for none", async () => {
    const dave = createClient(ScoreQueryController, asDave());
    expect(
      (
        await failureOf(
          dave.getAgentQualityReport({ org: ORG, agentId: privateAgentId }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    expect(
      (
        await failureOf(
          dave.listFlaggedByAgent({ org: ORG, agentId: privateAgentId }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    expect(
      (
        await failureOf(
          dave.getAgentQualityReport({ org: ORG, agentId: generateId("agt") }),
        )
      ).code,
    ).toBe(Code.NotFound);
  });

  it("refuses a person introducing the reserved eval label on a rating", async () => {
    const runId = await runOf(asCarol, "carols-other-chat");
    const failure = await failureOf(
      createClient(ScoreCommandController, asCarol()).create(
        thumbsDown(runId, { [PLUGIN_EVAL_LABEL]: "pev_forged" }),
      ),
    );
    expect(failure.code).toBe(Code.InvalidArgument);
    expect(failure.rawMessage).toContain(PLUGIN_EVAL_LABEL);
  });
});
