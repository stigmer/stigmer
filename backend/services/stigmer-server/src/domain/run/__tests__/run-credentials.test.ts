/**
 * Whose credentials a run may use is decided once, at create, by the
 * platform's one "is this a person" rule (domain/run/run-credentials.ts,
 * over extensions/identity.ts `isFirstPartyHumanOperator`), and recorded
 * on the run.
 *
 * Pins `personOfCaller` and the RecordRunPerson step: a first-party human
 * on the wire (the console, the CLI, an SDK speaking for themselves) is the
 * run's person; the open-source schedule fire (a `user` the server composes
 * a request for, in-process), a PlatformClient user token (a person spoken
 * for by a third-party client), and every other caller class (runner,
 * internal, machine, a channel, a shared-link guest) are not. The step
 * overwrites whatever person a request carried, since status is the
 * server's, and `recordedPersonOf` reads the recorded answer back, empty
 * meaning no person.
 *
 * And the record is what the run's values follow: the step and the
 * CreateExecutionContext step on one create context deliver the person's
 * own credential to a person's run and nothing personal to a schedule
 * fire's.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { credentialListIndex } from "../../credential/list-index.js";
import { CredentialValues } from "../../credential/values.js";
import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { newCreateExecutionContextStep } from "../create-execution-context-step.js";
import {
  newRecordRunPersonStep,
  personOfCaller,
  recordedPersonOf,
} from "../run-credentials.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A JWT carrying `payload`, unsigned: the rule reads the claims, never verifies them. */
function jwtWith(payload: Record<string, unknown>): string {
  const segment = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "RS256", typ: "JWT" })}.${segment(payload)}.signature`;
}

function caller(fields: Partial<CallerIdentity>): CallerIdentity {
  return testCallerIdentity({ identityId: "acc_ana", ...fields });
}

/** A PlatformClient user token: the platform's own issuer, naming the minting client. */
const PLATFORM_CLIENT_USER = caller({
  issuer: "stigmer",
  rawToken: jwtWith({
    iss: "stigmer",
    sub: "acc_ana",
    platform_client_id: "pcl_dashboard",
  }),
  platformClientId: "pcl_dashboard",
});

describe("personOfCaller", () => {
  it("a first-party human on the wire is the run's person", () => {
    expect(personOfCaller(caller({}))).toBe("acc_ana");
    expect(personOfCaller(caller({ origin: "wire" }))).toBe("acc_ana");
    expect(
      personOfCaller(
        caller({
          issuer: "https://issuer.example",
          rawToken: jwtWith({ iss: "https://issuer.example", sub: "acc_ana" }),
        }),
      ),
    ).toBe("acc_ana");
  });

  it("the open-source schedule fire, a user the server composed a request for, is no person", () => {
    expect(personOfCaller(caller({ origin: "in-process" }))).toBe("");
  });

  it("a PlatformClient user token is no person", () => {
    expect(personOfCaller(PLATFORM_CLIENT_USER)).toBe("");
  });

  it("every caller class but user is no person", () => {
    for (const callerClass of [
      "runner",
      "internal",
      "machine",
      "channel",
      "guest",
      "schedule",
    ]) {
      expect(personOfCaller(caller({ callerClass })), callerClass).toBe("");
    }
  });
});

describe("RecordRunPerson", () => {
  async function recorded(
    by: CallerIdentity,
    requestPerson = "",
  ): Promise<RequestContext<typeof RunSchema>> {
    const ctx = new RequestContext(
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_record", org: "acme" },
        status: {
          phase: RunPhase.RUN_PENDING,
          credentials: { person: requestPerson },
        },
      }),
      by,
      ApiResourceKind.run,
    );
    await newRecordRunPersonStep().execute(ctx);
    return ctx;
  }

  it("records a first-party human as the run's person", async () => {
    const ctx = await recorded(caller({}));
    expect(ctx.newState.status?.credentials?.person).toBe("acc_ana");
    expect(recordedPersonOf(ctx.newState)).toBe("acc_ana");
    // The rest of the status is left as it was.
    expect(ctx.newState.status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("records no person for a caller that is not one, whatever the request carried", async () => {
    for (const by of [
      caller({ origin: "in-process" }),
      PLATFORM_CLIENT_USER,
      caller({ callerClass: "runner" }),
      caller({ callerClass: "internal" }),
      caller({ callerClass: "channel" }),
      caller({ callerClass: "guest" }),
    ]) {
      const ctx = await recorded(by, "acc_ben");
      expect(ctx.newState.status?.credentials?.person, by.callerClass).toBe("");
      expect(recordedPersonOf(ctx.newState)).toBeUndefined();
    }
  });

  it("overwrites a person the request named with the caller", async () => {
    const ctx = await recorded(caller({}), "acc_ben");
    expect(ctx.newState.status?.credentials?.person).toBe("acc_ana");
  });

  it("records on a run that carried no status", async () => {
    const ctx = new RequestContext(
      RunSchema,
      create(RunSchema, { metadata: { id: "run_bare", org: "acme" } }),
      caller({}),
      ApiResourceKind.run,
    );
    await newRecordRunPersonStep().execute(ctx);
    expect(recordedPersonOf(ctx.newState)).toBe("acc_ana");
  });
});

describe("the recorded person decides the run's values", () => {
  let dir: string;
  let store: Store;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "run-credentials-"));
    store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
      listIndexes: [credentialListIndex],
    });
    await store.saveResource(
      ApiResourceKind.credential,
      "cred_ana_key",
      CredentialSchema,
      create(CredentialSchema, {
        metadata: { id: "cred_ana_key", org: "acme", slug: "ana-key" },
        spec: {
          owner: { case: "person", value: "acc_ana" },
          fields: { API_KEY: { value: "ana-key", plain: true } },
          serves: [
            {
              target: {
                case: "agent",
                value: {
                  kind: ApiResourceKind.agent,
                  org: "acme",
                  slug: "helper",
                },
              },
            },
          ],
        },
      }),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function deps(createdEcs: ExecutionContext[]): ExecutionContextBuilderDeps {
    return {
      store,
      logger: silentLogger,
      agentLoader: () => ({
        get: async () =>
          create(AgentSchema, {
            metadata: { id: "agt_helper", org: "acme", slug: "helper" },
            spec: { env: { API_KEY: { isSecret: true, optional: true } } },
          }),
        getVersion: async () => {
          throw new Error("this turn records no agent version");
        },
      }),
      sessionLoader: () => ({
        get: async (sessionId) =>
          create(SessionSchema, { metadata: { id: sessionId, org: "acme" } }),
      }),
      executionContextCreator: () => ({
        create: async (ec) => {
          createdEcs.push(ec);
          return ec;
        },
      }),
      executionContextDeleter: () => ({
        delete: () => Promise.reject(new Error("unused on the create path")),
      }),
      credentials: {
        store,
        logger: silentLogger,
        authorizer: {
          authorize: async () => ({
            kind: "deny",
            reason: "no grants in this test",
          }),
        },
        values: new CredentialValues(
          SecretService.create(randomBytes(32)),
          silentLogger,
        ),
        signIns: {
          freshen: async () => {
            throw new ConnectError("no sign-in in this test", Code.Internal);
          },
        },
      },
      platformClients: {
        findById: async () => {
          throw new Error("no run here was created through a platform client");
        },
      },
    };
  }

  async function createdBy(
    by: CallerIdentity,
  ): Promise<ExecutionContext | undefined> {
    const createdEcs: ExecutionContext[] = [];
    const ctx = new RequestContext(
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_follow", org: "acme" },
        spec: {
          target: { case: "sessionId", value: "ses_follow" },
          message: "hi",
        },
        status: { agentId: "agt_helper" },
      }),
      by,
      ApiResourceKind.run,
    );
    await newRecordRunPersonStep().execute(ctx);
    await newCreateExecutionContextStep(deps(createdEcs)).execute(ctx);
    return createdEcs[0];
  }

  it("a person's run receives their own credential", async () => {
    const ec = await createdBy(caller({}));
    expect(ec?.spec?.data["API_KEY"]?.value).toBe("ana-key");
  });

  it("the same person's schedule fire receives nothing personal", async () => {
    const ec = await createdBy(caller({ origin: "in-process" }));
    expect(ec?.spec?.data).toEqual({});
  });
});
