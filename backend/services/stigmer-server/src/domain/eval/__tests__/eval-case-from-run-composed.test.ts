/**
 * Pins buildCaseFromRun and addCaseFromRun on a real boot under the
 * BUILT-IN posture, with two people of one organization: Carol, who
 * founded it, and Dave, a member. Their conversations are stored rows and
 * session events, as a turn leaves them; the evals are pushed as the CLI
 * pushes them.
 *
 *   - Carol builds a case from her ended turn: the archive holds the case
 *     under its suggested name, its history and its mocks, and its digest
 *     is the archive's;
 *   - she adds it to her eval: the new version holds the eval's cases and
 *     the new one, under the version message the request named or one
 *     naming the run, and the tag it named; adding a case of a name the
 *     eval holds is refused;
 *   - a turn that has not ended, a run that is not there, and a case name
 *     an eval's root keeps for itself are refused, building or adding;
 *   - Dave may not build from Carol's private conversation, nor add his own
 *     turn to Carol's eval, whose edit he does not hold; naming her private
 *     eval, a case name it holds and one it does not get him the one
 *     refusal a push gets, before its archive is read; and once members may
 *     not create evals, a slug nothing holds gets him that refusal too, as
 *     a push to it would;
 *   - an eval named in another organization is refused before it is read,
 *     one of another organization named by id reads as not there, and so
 *     does a slug nothing holds;
 *   - a push landing while a case is being added is kept: one landing as
 *     the add writes, and one landing between the add's read of the eval
 *     and the push's own read, each makes the add run again on it; an eval
 *     deleted under an add answers not found.
 *
 * And on a trusted-local boot, where no authorization answers first: a run
 * that is not there is not found, an eval whose archive is gone answers
 * its archive not found, and a store fault reading the run, looking the
 * eval up or reading its current row is an internal fault, never a
 * refusal.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inMemoryPluginFiles, readEvalFolder } from "@stigmer/plugin-package";
import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { openArchiveFiles } from "../../../archive/open-files.js";
import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { baseConfig, fakeJwt, fakeVerifier, silentLogger, transportFor } from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { writeLandsMidUpdate } from "../../../pipeline/__tests__/race-support.js";
import { RunEventsBuilder, appendRunEvents } from "../../session/events/__tests__/run-events-fixture.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import {
  EVAL_CASE_OTHER_ORGANIZATION,
  EVAL_CASE_RUN_DENIED,
  EVAL_PUSH_DENIED,
  evalCaseExistsMessage,
  evalCaseReservedNameMessage,
  evalCaseRunNotEndedMessage,
  evalCaseVersionMessage,
} from "../constants.js";

const CAROL = "fake|carol";
const DAVE = "fake|dave";
const ORG = "case-from-run-org";
const OTHER_ORG = "case-from-run-other";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply answers.\n";

function folder(...cases: string[]): Uint8Array {
  return writeArchive(
    cases.flatMap((name) => [
      { path: `${name}/prompt.md`, bytes: encoder.encode(`The ${name} case.\n`) },
      { path: `${name}/graders/judge.md`, bytes: encoder.encode(JUDGE) },
    ]),
  );
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

describe("an eval case from a run (built-in posture, composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgId: string;
  let otherOrgId: string;
  let carolId: string;
  let daveId: string;

  const asCarol = (): Transport => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = (): Transport => transportFor(port, fakeJwt(DAVE, "dave@example.com"));
  const carolEvals = () => createClient(EvalCommandController, asCarol());
  const carolQuery = () => createClient(EvalQueryController, asCarol());

  /** A private conversation of `owner`'s: an earlier turn, then the given turn's, with the given phase. */
  async function seedConversation(sessionId: string, owner: string, phase = RunPhase.RUN_COMPLETED): Promise<string> {
    const audit = { specAudit: { createdBy: { id: owner } } };
    await server.store.saveResource(
      ApiResourceKind.session,
      sessionId,
      SessionSchema,
      create(SessionSchema, { metadata: { id: sessionId, org: orgId }, spec: { harness: Harness.NATIVE }, status: { audit } }),
    );
    const run = (id: string, message: string, runPhase: RunPhase) =>
      create(RunSchema, {
        metadata: { id, org: orgId },
        spec: { target: { case: "sessionId", value: sessionId }, message },
        status: { phase: runPhase, audit },
      });
    const earlier = `${sessionId}_r1`;
    const turn = `${sessionId}_r2`;
    await server.store.saveResource(ApiResourceKind.run, earlier, RunSchema, run(earlier, "Where is order 1042?", RunPhase.RUN_COMPLETED));
    await appendRunEvents(
      server.store,
      sessionId,
      orgId,
      new RunEventsBuilder(earlier)
        .user("Where is order 1042?")
        .turnMessage("Looking.", [{ id: "a1", name: "lookup_order", mcpServer: "billing", result: "shipped" }])
        .turnMessage("It shipped.")
        .build(),
    );
    await server.store.saveResource(ApiResourceKind.run, turn, RunSchema, run(turn, "Refund it.", phase));
    await appendRunEvents(
      server.store,
      sessionId,
      orgId,
      new RunEventsBuilder(turn)
        .user("Refund it.")
        .turnMessage("", [{ id: "b1", name: "refund", mcpServer: "billing", result: "refund refused: past the window", isError: true }])
        .turnMessage("I cannot refund it.")
        .build(),
    );
    return turn;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "eval-case-from-run-"));
    const unit: ServerExtension = { name: "fake-oidc-only", requireAuthentication: true, identityVerifiers: [fakeVerifier] };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    carolId = (await createClient(IdentityAccountCommandController, asCarol()).provisionMyAccount({})).metadata!.id;
    const organizations = createClient(OrganizationCommandController, asCarol());
    const organization = (slug: string) =>
      organizations.create({ apiVersion: "tenancy.stigmer.ai/v1", kind: "Organization", metadata: { name: slug, slug, org: "" }, spec: { description: slug } });
    orgId = (await organization(ORG)).metadata!.id;
    otherOrgId = (await organization(OTHER_ORG)).metadata!.id;
    daveId = (await createClient(IdentityAccountCommandController, asDave()).provisionMyAccount({})).metadata!.id;
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds the case of an ended turn as an archive: the case, its history and its mocks, its digest the archive's", async () => {
    const runId = await seedConversation("ses_build", carolId);
    const built = await carolQuery().buildCaseFromRun({ runId });
    expect(built.caseName).toBe("refund-it");
    expect(built.digest).toBe(createHash("sha256").update(built.artifact).digest("hex"));
    expect(built.notes).toEqual([]);
    const { files } = openArchiveFiles(built.artifact, "eval");
    expect(files.entries.map((entry) => entry.path).sort()).toEqual([
      "refund-it/case.yaml",
      "refund-it/graders/criteria.md",
      "refund-it/history.jsonl",
      "refund-it/mocks/billing/refund.md",
      "refund-it/prompt.md",
    ]);
    expect(decoder.decode(files.read("refund-it/mocks/billing/refund.md"))).toBe("---\ntype: fixed\nerror: true\n---\nrefund refused: past the window");
    expect(decoder.decode(files.read("refund-it/history.jsonl"))).toContain("Where is order 1042?");
    expect(readEvalFolder(files).findings).toEqual([]);
  });

  it("adds the case to an eval as a version holding its cases and the new one, with its message and tag", async () => {
    const runId = await seedConversation("ses_add", carolId);
    const slug = "carols-cases";
    const pushed = await carolEvals().push({ org: ORG, slug, artifact: folder("first") });

    const named = await carolEvals().addCaseFromRun({ runId, eval: { slug }, caseName: "refused-refund", message: "from the support queue", tag: "triaged" });
    expect(named.metadata?.id).toBe(pushed.metadata?.id);
    expect(named.status?.cases.map((c) => c.caseName).sort()).toEqual(["first", "refused-refund"]);
    expect(named.spec?.tag).toBe("triaged");
    const unnamed = await carolEvals().addCaseFromRun({ runId, eval: { org: ORG, slug } });
    expect(unnamed.status?.cases.map((c) => c.caseName).sort()).toEqual(["first", "refund-it", "refused-refund"]);

    const versions = await carolQuery().listVersions({ slug, org: ORG });
    expect(versions.entries.map((entry) => entry.message)).toEqual([evalCaseVersionMessage("refund-it", runId), "from the support queue", ""]);

    const collision = await failureOf(carolEvals().addCaseFromRun({ runId, eval: { slug }, caseName: "first" }));
    expect(collision.code).toBe(Code.AlreadyExists);
    expect(collision.rawMessage).toBe(evalCaseExistsMessage("first", slug));
  });

  it("refuses a turn that has not ended, a run that is not there and a name an eval's root keeps, building or adding", async () => {
    const running = await seedConversation("ses_running", carolId, RunPhase.RUN_IN_PROGRESS);
    await carolEvals().push({ org: ORG, slug: "carols-other", artifact: folder("first") });
    for (const call of [
      () => carolQuery().buildCaseFromRun({ runId: running }),
      () => carolEvals().addCaseFromRun({ runId: running, eval: { slug: "carols-other" } }),
    ]) {
      const refused = await failureOf(call());
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(evalCaseRunNotEndedMessage(running));
    }
    expect((await failureOf(carolQuery().buildCaseFromRun({ runId: "run_absent" }))).code).toBe(Code.NotFound);
    const reserved = await failureOf(carolQuery().buildCaseFromRun({ runId: running, caseName: "mocks" }));
    expect(reserved.code).toBe(Code.InvalidArgument);
    expect(reserved.rawMessage).toBe(evalCaseReservedNameMessage("mocks"));
  });

  it("refuses Dave a case from Carol's private conversation, and his own turn added to her eval", async () => {
    const carols = await seedConversation("ses_carols", carolId);
    const davesTurn = await seedConversation("ses_daves", daveId);
    await carolEvals().push({ org: ORG, slug: "carols-guarded", artifact: folder("first") });
    const dave = createClient(EvalQueryController, asDave());

    const fromHers = await failureOf(dave.buildCaseFromRun({ runId: carols }));
    expect(fromHers.code).toBe(Code.PermissionDenied);
    expect(fromHers.rawMessage).toBe(EVAL_CASE_RUN_DENIED);
    expect((await dave.buildCaseFromRun({ runId: davesTurn })).caseName).toBe("refund-it");
    const ontoHers = await failureOf(createClient(EvalCommandController, asDave()).addCaseFromRun({ runId: davesTurn, eval: { slug: "carols-guarded" } }));
    expect(ontoHers.code).toBe(Code.PermissionDenied);
    expect(ontoHers.rawMessage).toBe(EVAL_PUSH_DENIED);
  });

  it("refuses Dave an eval he may not edit before its archive is read, whatever case name he names", async () => {
    const davesTurn = await seedConversation("ses_daves_probe", daveId);
    const hidden = await carolEvals().push({
      org: ORG,
      slug: "carols-hidden",
      artifact: folder("first"),
      visibility: ApiResourceVisibility.visibility_private,
    });
    // With the archive gone, any read of it would answer otherwise.
    const archive = `${hidden.status?.digest ?? ""}.zip`;
    const removeArchive = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, entry.name);
        if (entry.isDirectory()) removeArchive(full);
        else if (entry.name === archive) rmSync(full);
      }
    };
    removeArchive(dir);
    const dave = createClient(EvalCommandController, asDave());
    for (const caseName of ["first", "a-new-one"]) {
      const refused = await failureOf(dave.addCaseFromRun({ runId: davesTurn, eval: { slug: "carols-hidden" }, caseName }));
      expect([refused.code, refused.rawMessage]).toEqual([Code.PermissionDenied, EVAL_PUSH_DENIED]);
    }

    await createClient(OrganizationCommandController, asCarol()).updatePolicies({ orgId, policies: { membersCanCreateAgents: false } });
    try {
      const nothing = await failureOf(dave.addCaseFromRun({ runId: davesTurn, eval: { slug: "nothing-holds-this" } }));
      expect([nothing.code, nothing.rawMessage]).toEqual([Code.PermissionDenied, EVAL_PUSH_DENIED]);
    } finally {
      await createClient(OrganizationCommandController, asCarol()).updatePolicies({ orgId, policies: { membersCanCreateAgents: true } });
    }
  });

  it("refuses an eval of another organization, and reads one named there by id, or a slug nothing holds, as not there", async () => {
    const runId = await seedConversation("ses_orgs", carolId);
    const elsewhere = await carolEvals().push({ org: OTHER_ORG, slug: "elsewhere-cases", artifact: folder("first") });

    const named = await failureOf(carolEvals().addCaseFromRun({ runId, eval: { org: OTHER_ORG, slug: "elsewhere-cases" } }));
    expect(named.code).toBe(Code.FailedPrecondition);
    expect(named.rawMessage).toBe(EVAL_CASE_OTHER_ORGANIZATION);
    expect(elsewhere.metadata?.org).toBe(otherOrgId);
    const byId = await failureOf(carolEvals().addCaseFromRun({ runId, eval: { id: elsewhere.metadata!.id } }));
    expect(byId.code).toBe(Code.NotFound);
    const absent = await failureOf(carolEvals().addCaseFromRun({ runId, eval: { slug: "no-such-cases" } }));
    expect(absent.code).toBe(Code.NotFound);
  });

  it("keeps a push landing as the add writes, adding the case to it", async () => {
    const runId = await seedConversation("ses_race_write", carolId);
    const slug = "carols-raced";
    const pushed = await carolEvals().push({ org: ORG, slug, artifact: folder("first") });
    const { result, writes } = await writeLandsMidUpdate(
      server.store,
      ApiResourceKind.eval,
      pushed.metadata!.id,
      () => carolEvals().push({ org: ORG, slug, artifact: folder("first", "concurrent") }),
      () => carolEvals().addCaseFromRun({ runId, eval: { slug } }),
    );
    expect(writes).toBeGreaterThanOrEqual(2);
    expect(result.status?.cases.map((c) => c.caseName).sort()).toEqual(["concurrent", "first", "refund-it"]);
  });

  it("builds again on a push landing between its read of the eval and the push's, and answers not found once the eval is gone", async () => {
    const runId = await seedConversation("ses_race_read", carolId);
    const slug = "carols-reread";
    const pushed = await carolEvals().push({ org: ORG, slug, artifact: folder("first") });
    let id = pushed.metadata!.id;
    // The add reads the eval twice before its push does: the reference's
    // lookup, then the current row inside the write's attempt. The landing
    // write follows the second, unless the test names the first.
    const landAfterHeadRead = async (land: () => Promise<unknown>, add: () => Promise<unknown>, after = 2): Promise<unknown> => {
      const getResource = server.store.getResource.bind(server.store);
      let reads = 0;
      server.store.getResource = (async (...args: Parameters<typeof getResource>) => {
        const row = await getResource(...args);
        if (args[0] === ApiResourceKind.eval && args[1] === id && ++reads === after) {
          await land();
        }
        return row;
      }) as typeof server.store.getResource;
      try {
        return await add();
      } finally {
        server.store.getResource = getResource;
      }
    };

    const added = (await landAfterHeadRead(
      () => carolEvals().push({ org: ORG, slug, artifact: folder("first", "landed") }),
      () => carolEvals().addCaseFromRun({ runId, eval: { slug } }),
    )) as Awaited<ReturnType<ReturnType<typeof carolEvals>["addCaseFromRun"]>>;
    expect(added.status?.cases.map((c) => c.caseName).sort()).toEqual(["first", "landed", "refund-it"]);

    const gone = await failureOf(
      landAfterHeadRead(
        () => carolEvals().delete({ value: id }),
        () => carolEvals().addCaseFromRun({ runId, eval: { slug }, caseName: "after-delete" }),
      ),
    );
    expect(gone.code).toBe(Code.NotFound);

    // Deleted after the reference's lookup, before the attempt reads it.
    const again = await carolEvals().push({ org: ORG, slug: "carols-reread-again", artifact: folder("first") });
    id = again.metadata!.id;
    const goneEarly = await failureOf(
      landAfterHeadRead(
        () => carolEvals().delete({ value: id }),
        () => carolEvals().addCaseFromRun({ runId, eval: { slug: "carols-reread-again" } }),
        1,
      ),
    );
    expect(goneEarly.code).toBe(Code.NotFound);
  });
});

describe("an eval case from a run (trusted-local, composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let orgId: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "eval-case-from-run-local-"));
    server = await composeServer({ config: loadConfig(baseConfig(dir)), logger: silentLogger, portOverride: 0, host: "127.0.0.1" });
    transport = transportFor(await server.start(), "");
    orgId = organizationId(await seedOrganizations(transport, ["local-org"]), "local-org");
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedTurn(runId: string): Promise<void> {
    await server.store.saveResource(
      ApiResourceKind.session,
      `ses_${runId}`,
      SessionSchema,
      create(SessionSchema, { metadata: { id: `ses_${runId}`, org: orgId }, spec: { harness: Harness.NATIVE } }),
    );
    await server.store.saveResource(
      ApiResourceKind.run,
      runId,
      RunSchema,
      create(RunSchema, {
        metadata: { id: runId, org: orgId },
        spec: { target: { case: "sessionId", value: `ses_${runId}` }, message: "Refund it." },
        status: { phase: RunPhase.RUN_COMPLETED },
      }),
    );
    await appendRunEvents(server.store, `ses_${runId}`, orgId, new RunEventsBuilder(runId).user("Refund it.").turnMessage("No.").build());
  }

  /** Runs `call` with the store's read of `kind` failing from its `nth` call on. */
  async function withFailingRead<T>(kind: ApiResourceKind, nth: number, call: () => Promise<T>): Promise<T> {
    const getResource = server.store.getResource.bind(server.store);
    let reads = 0;
    server.store.getResource = (async (...args: Parameters<typeof getResource>) => {
      if (args[0] === kind && ++reads >= nth) {
        throw new Error("disk unavailable");
      }
      return getResource(...args);
    }) as typeof server.store.getResource;
    try {
      return await call();
    } finally {
      server.store.getResource = getResource;
    }
  }

  it("answers a run that is not there as not found, and a fault reading the run as internal", async () => {
    const query = createClient(EvalQueryController, transport);
    expect((await failureOf(query.buildCaseFromRun({ runId: "run_absent" }))).code).toBe(Code.NotFound);
    await seedTurn("run_local_fault");
    const fault = await failureOf(withFailingRead(ApiResourceKind.run, 1, () => query.buildCaseFromRun({ runId: "run_local_fault" })));
    expect(fault.code).toBe(Code.Internal);
  });

  it("answers an eval whose archive is gone as its archive not found, and faults looking it up or reading it as internal", async () => {
    await seedTurn("run_local_add");
    const evals = createClient(EvalCommandController, transport);
    const pushed = await evals.push({ org: orgId, slug: "local-cases", artifact: folder("first") });
    const add = () => evals.addCaseFromRun({ runId: "run_local_add", eval: { slug: "local-cases" } });

    expect((await failureOf(withFailingRead(ApiResourceKind.eval, 1, add))).code).toBe(Code.Internal);
    expect((await failureOf(withFailingRead(ApiResourceKind.eval, 2, add))).code).toBe(Code.Internal);

    const archive = `${pushed.status?.digest ?? ""}.zip`;
    const removeArchive = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, entry.name);
        if (entry.isDirectory()) removeArchive(full);
        else if (entry.name === archive) rmSync(full);
      }
    };
    removeArchive(dir);
    const gone = await failureOf(add());
    expect(gone.code).toBe(Code.NotFound);
    expect(gone.rawMessage).toContain("eval archive");
  });
});
