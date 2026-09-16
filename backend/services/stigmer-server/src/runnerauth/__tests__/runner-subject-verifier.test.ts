/**
 * Pins the runner-subject identity verifier on both store drivers: the
 * OSS execution-scoped runner token, presented as a bearer under the
 * built-in authorization posture, admits its bearer AS THE HUMAN WHO
 * ASKED — for a run, the person the execution row's creator stamp
 * names, for exactly as long as that execution lives; for an MCP
 * connect, the person the connect's ExecutionContext row was created by,
 * for as long as that row exists — in the `runner` caller class. A
 * clockless token bound to a connect is a shape no mint produces and is
 * refused as the credential it is not.
 *
 * Why a verifier reads the store: the token is a capability for one
 * execution, not an identity assertion. Its claims name only the
 * execution; the server resolves the person from the row (the account
 * id stamp since 3.15.0, the raw issuer subject the 3.14.x verifiers
 * stamped — the schedule fire caller's two shapes) and mints the account
 * acting as itself, so the audit actor carries the person's email and
 * display name that no token could. Validity is the row's: a terminal or
 * missing execution refuses; a run credential carries no `exp`, because
 * runs wait on humans with no timeout and outlive any clock, and a
 * present `exp` in the past still refuses (the exchange lane's tokens
 * keep their clock).
 *
 * Claim rule: exactly `token_type === "execution_scoped"` read from the
 * UNTRUSTED payload; every other shape passes (the OIDC verifier's JWTs,
 * the API-key lane's `stk_`, garbage). A token that names the type and
 * fails the HMAC is claimed and refused — never passed to a laxer
 * verifier (the identity.ts contract). Refusals are UNAUTHENTICATED with
 * one sentence for the token arms and one for the resolution arms (a
 * finer reason invites branching; the runner is the only caller and its
 * operator reads the log). A store fault propagates as the fault it is.
 *
 * Written failing on 2026-09-16, before src/runnerauth/runner-subject-verifier.ts
 * exists; the module that follows turns it green. The composed three-posture proof is
 * runner-subject-composed.test.ts; the capabilities the same token feeds
 * are built-in-runner-credential-provider.test.ts.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import {
  driverFixtures,
  dropPostgresFixture,
} from "../../authorization/__tests__/drivers.js";
import type { OpenedStore } from "../../authorization/__tests__/drivers.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import { newConnectExecutionId } from "../../domain/mcpserver/connect-execution-id.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { newOrganizationOnlyGrantScope } from "../../domain/iampolicy/grant-scope.js";
import {
  RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS,
  RUNNER_CREDENTIAL_INVALID_MESSAGE,
  RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE,
  RUNNER_VERIFIER_NAME,
} from "../constants.js";
import { newExecutionScopedRunnerCredentialProvider } from "../runner-credential-provider.js";
import { newRunnerSubjectIdentityVerifier } from "../runner-subject-verifier.js";
import {
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../runnerauth.js";

const KEY = randomBytes(32);
const SUBJECT = "auth0|carol";
const CAROL = accountIdFor(SUBJECT);
const CAROL_IDENTITY = {
  identityId: CAROL,
  callerClass: "runner",
  issuer: "",
  email: "carol@example.com",
  displayName: "Carol Danvers",
};

const segment = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** A three-segment token whose payload we control and whose signature is NOT the server's. */
function forgedToken(payload: Record<string, unknown>): string {
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment(payload)}.${segment("not-the-servers-mac")}`;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
}

function expectUnauthenticated(failure: unknown, message: string): void {
  expect(failure).toBeInstanceOf(ConnectError);
  expect((failure as ConnectError).code).toBe(Code.Unauthenticated);
  expect((failure as ConnectError).rawMessage).toBe(message);
}

afterAll(dropPostgresFixture);

describe.each(
  driverFixtures([
    ApiResourceKind.agent_execution,
    ApiResourceKind.workflow_execution,
    ApiResourceKind.execution_context,
    ApiResourceKind.identity_account,
  ]),
)("the runner-subject verifier on $name", (fixture) => {
  describe.skipIf(fixture.skip)("verify", () => {
    let opened: OpenedStore;
    let accounts: IdentityAccountStore;
    const service = RunnerAuthService.create(KEY);
    const credentials = newExecutionScopedRunnerCredentialProvider(service);

    beforeEach(async () => {
      opened = await fixture.open();
      accounts = newResourceIdentityAccountStore(opened.store);
      await accounts.save(
        create(IdentityAccountSchema, {
          metadata: { id: CAROL, name: "Carol Danvers" },
          spec: {
            idpId: SUBJECT,
            email: "carol@example.com",
            provisioningMode: IdentityAccountProvisioningMode.direct,
          },
        }),
      );
    });

    afterEach(async () => {
      await opened.close();
    });

    async function agentExecution(
      id: string,
      createdBy: string,
      phase: ExecutionPhase = ExecutionPhase.EXECUTION_IN_PROGRESS,
    ): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
        create(AgentExecutionSchema, {
          metadata: { id, name: id, org: "acme" },
          status: {
            phase,
            audit: { specAudit: { createdBy: { id: createdBy } } },
          },
        }),
      );
    }

    async function workflowExecution(
      id: string,
      createdBy: string,
      phase: WorkflowExecutionPhase = WorkflowExecutionPhase.EXECUTION_IN_PROGRESS,
    ): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.workflow_execution,
        id,
        WorkflowExecutionSchema,
        create(WorkflowExecutionSchema, {
          metadata: { id, name: id, org: "acme" },
          status: {
            phase,
            audit: { specAudit: { createdBy: { id: createdBy } } },
          },
        }),
      );
    }

    /** The connect lane's ephemeral EC, created as `createdBy` (connect.ts `prepareConnect`). */
    async function connectContext(
      executionId: string,
      createdBy: string,
    ): Promise<void> {
      await opened.store.saveResource(
        ApiResourceKind.execution_context,
        `ectx_${executionId}`,
        ExecutionContextSchema,
        create(ExecutionContextSchema, {
          metadata: {
            id: `ectx_${executionId}`,
            name: `exec-ctx-${executionId}`,
            org: "acme",
          },
          spec: { executionId },
          status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
        }),
      );
    }

    function verifier() {
      return newRunnerSubjectIdentityVerifier({
        store: opened.store,
        accounts,
        credentials,
      });
    }

    it("is named for the boot log and the auth failures", () => {
      expect(verifier().name).toBe(RUNNER_VERIFIER_NAME);
      expect(RUNNER_VERIFIER_NAME).toBe("runner");
    });

    describe("claim-or-pass", () => {
      it.each([
        ["an API key", "stk_notajwt"],
        ["garbage", "not.even.close.to.a.token"],
        [
          "an OIDC-shaped JWT (no token_type claim)",
          forgedToken({
            sub: "auth0|someone",
            iss: "https://issuer.example.com/",
          }),
        ],
        [
          "another edition's runner token (a token_type that is not ours)",
          forgedToken({
            token_type: "sandbox",
            session_id: "ses_x",
            sub: "auth0|someone",
          }),
        ],
      ])(
        "passes (null) on %s — the next verifier's business",
        async (_label, token) => {
          expect(await verifier().verify(token)).toBeNull();
        },
      );

      it("a token that names our type and fails the HMAC is CLAIMED and refused — never passed to a laxer verifier", async () => {
        await agentExecution("aex_forged", CAROL);
        const failure = await rejectionOf(
          verifier().verify(
            forgedToken({
              token_type: TOKEN_TYPE_EXECUTION_SCOPED,
              execution_id: "aex_forged",
            }),
          ),
        );
        expectUnauthenticated(failure, RUNNER_CREDENTIAL_INVALID_MESSAGE);
      });
    });

    describe("the run credential admits its bearer as the run's human", () => {
      it("an agent execution stamped with the creator's account id: the account acting as itself, class runner, the raw token carried", async () => {
        await agentExecution("aex_by_id", CAROL);
        const token = service.mintRunCredential("aex_by_id");
        expect(await verifier().verify(token)).toEqual({
          ...CAROL_IDENTITY,
          rawToken: token,
        });
      });

      it("an agent execution stamped with the raw issuer subject (the 3.14.x shape) resolves to the same account", async () => {
        await agentExecution("aex_by_sub", SUBJECT);
        const identity = await verifier().verify(
          service.mintRunCredential("aex_by_sub"),
        );
        expect(identity?.identityId).toBe(CAROL);
        expect(identity?.callerClass).toBe("runner");
      });

      it("a workflow execution binding resolves the same way — the kind is read off the id's prefix, no second read", async () => {
        await workflowExecution("wex_by_id", CAROL);
        const token = service.mintRunCredential("wex_by_id");
        expect(await verifier().verify(token)).toEqual({
          ...CAROL_IDENTITY,
          rawToken: token,
        });
      });

      it("a PENDING execution is live — the runner's first read happens before any phase write", async () => {
        await agentExecution(
          "aex_pending",
          CAROL,
          ExecutionPhase.EXECUTION_PENDING,
        );
        expect(
          (await verifier().verify(service.mintRunCredential("aex_pending")))
            ?.identityId,
        ).toBe(CAROL);
      });

      it("the exchange lane's clocked token (a present, future exp) admits the same way while its clock runs", async () => {
        await agentExecution("aex_clocked", CAROL);
        const minted = service.mint("aex_clocked", 300);
        expect((await verifier().verify(minted.token))?.identityId).toBe(CAROL);
      });
    });

    describe("the connect token admits its bearer as the person who asked for the connect", () => {
      const connectId = newConnectExecutionId("mcps_carols");

      it("the connect lane's clocked token resolves through the connect's ExecutionContext row: its creator, class runner", async () => {
        await connectContext(connectId, CAROL);
        const { token } = service.mint(connectId, 300);
        expect(await verifier().verify(token)).toEqual({
          ...CAROL_IDENTITY,
          rawToken: token,
        });
      });

      it("once the connect settles and its row is gone, the token is the token sentence — it names no row", async () => {
        const { token } = service.mint(connectId, 300);
        expectUnauthenticated(
          await rejectionOf(verifier().verify(token)),
          RUNNER_CREDENTIAL_INVALID_MESSAGE,
        );
      });

      it("a clockless token bound to a connect is refused even while the row exists — no mint produces that shape", async () => {
        await connectContext(connectId, CAROL);
        expectUnauthenticated(
          await rejectionOf(
            verifier().verify(service.mintRunCredential(connectId)),
          ),
          RUNNER_CREDENTIAL_INVALID_MESSAGE,
        );
      });

      it("a connect row created by nobody the server recognizes is the liveness sentence — a discovery for no one", async () => {
        await connectContext(connectId, "system");
        expectUnauthenticated(
          await rejectionOf(
            verifier().verify(service.mint(connectId, 300).token),
          ),
          RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE,
        );
      });
    });

    describe("validity is the row's, not a clock's", () => {
      it.each([
        ["COMPLETED", ExecutionPhase.EXECUTION_COMPLETED],
        ["FAILED", ExecutionPhase.EXECUTION_FAILED],
        ["CANCELLED", ExecutionPhase.EXECUTION_CANCELLED],
      ])(
        "a %s execution's credential is refused with the liveness sentence",
        async (_label, phase) => {
          await agentExecution("aex_over", CAROL, phase);
          const failure = await rejectionOf(
            verifier().verify(service.mintRunCredential("aex_over")),
          );
          expectUnauthenticated(failure, RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE);
        },
      );

      it("a run that ended moments ago still admits — the grace covers the writes that trail the terminal stamp", async () => {
        await opened.store.saveResource(
          ApiResourceKind.agent_execution,
          "aex_just_over",
          AgentExecutionSchema,
          create(AgentExecutionSchema, {
            metadata: {
              id: "aex_just_over",
              name: "aex_just_over",
              org: "acme",
            },
            status: {
              phase: ExecutionPhase.EXECUTION_COMPLETED,
              completedAt: new Date().toISOString(),
              audit: { specAudit: { createdBy: { id: CAROL } } },
            },
          }),
        );
        expect(
          (await verifier().verify(service.mintRunCredential("aex_just_over")))
            ?.identityId,
        ).toBe(CAROL);
      });

      it("a run that ended past the grace is refused — the grace is a constant, not a second clock", async () => {
        await opened.store.saveResource(
          ApiResourceKind.agent_execution,
          "aex_long_over",
          AgentExecutionSchema,
          create(AgentExecutionSchema, {
            metadata: {
              id: "aex_long_over",
              name: "aex_long_over",
              org: "acme",
            },
            status: {
              phase: ExecutionPhase.EXECUTION_COMPLETED,
              completedAt: new Date(
                Date.now() - RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS - 1000,
              ).toISOString(),
              audit: { specAudit: { createdBy: { id: CAROL } } },
            },
          }),
        );
        expectUnauthenticated(
          await rejectionOf(
            verifier().verify(service.mintRunCredential("aex_long_over")),
          ),
          RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE,
        );
      });

      it("a terminal WORKFLOW execution's credential is refused the same way", async () => {
        await workflowExecution(
          "wex_over",
          CAROL,
          WorkflowExecutionPhase.EXECUTION_COMPLETED,
        );
        const failure = await rejectionOf(
          verifier().verify(service.mintRunCredential("wex_over")),
        );
        expectUnauthenticated(failure, RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE);
      });

      it("an execution that does not exist is UNAUTHENTICATED with the token sentence — the credential is invalid, the run is not the caller's to learn about", async () => {
        const failure = await rejectionOf(
          verifier().verify(service.mintRunCredential("aex_missing")),
        );
        expectUnauthenticated(failure, RUNNER_CREDENTIAL_INVALID_MESSAGE);
      });

      it("a token bound to an id whose prefix names no kind this server serves is the token sentence, not a store read", async () => {
        const failure = await rejectionOf(
          verifier().verify(service.mintRunCredential("zzz_unknown_kind")),
        );
        expectUnauthenticated(failure, RUNNER_CREDENTIAL_INVALID_MESSAGE);
      });

      it("a present exp in the past is refused even while the row lives — the exchange lane's clock still counts", async () => {
        await agentExecution("aex_expired", CAROL);
        const minted = service.mint("aex_expired", 1);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expectUnauthenticated(
          await rejectionOf(verifier().verify(minted.token)),
          RUNNER_CREDENTIAL_INVALID_MESSAGE,
        );
      });
    });

    describe("a run whose stamp names no person is nobody's", () => {
      it.each([
        ["the empty stamp", ""],
        ["the laptop's placeholder", "system"],
        ["a trusted-local email stamp", "operator@example.com"],
        ["a deleted account", accountIdFor("auth0|gone")],
      ])(
        "%s refuses with the liveness sentence — deterministic, never a retry",
        async (_label, stamp) => {
          await agentExecution("aex_nobody", stamp);
          const failure = await rejectionOf(
            verifier().verify(service.mintRunCredential("aex_nobody")),
          );
          expectUnauthenticated(failure, RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE);
        },
      );
    });

    describe("faults are faults", () => {
      it("a store fault loading the execution propagates as the error it is — the chassis maps INTERNAL, never a credential rejection", async () => {
        await agentExecution("aex_fault", CAROL);
        const fault = new Error("connection reset");
        const failing = newRunnerSubjectIdentityVerifier({
          store: { ...opened.store, getResource: () => Promise.reject(fault) },
          accounts,
          credentials,
        });
        await expect(
          failing.verify(service.mintRunCredential("aex_fault")),
        ).rejects.toBe(fault);
      });

      it("a keyless service refuses every token that names our type (fail closed: without a key no token can be genuine)", async () => {
        await agentExecution("aex_keyless", CAROL);
        const keyless = newRunnerSubjectIdentityVerifier({
          store: opened.store,
          accounts,
          credentials: newExecutionScopedRunnerCredentialProvider(
            RunnerAuthService.create(undefined),
          ),
        });
        const failure = await rejectionOf(
          keyless.verify(service.mintRunCredential("aex_keyless")),
        );
        expectUnauthenticated(failure, RUNNER_CREDENTIAL_INVALID_MESSAGE);
      });
    });
  });
});

describe("the person admitted is the person the model lets report", () => {
  it("open source grants nobody a role on a session, so a run's creator is its session's owner — the fact the verifier's header rests on", () => {
    // `agent_execution.can_edit` is `owner from session`; this verifier
    // admits the execution's CREATOR. They are one person only while a
    // session's viewers are its owner alone. The contract lists `viewer`
    // as grantable on a session; open source's grant scope refuses it.
    expect(
      newOrganizationOnlyGrantScope().grantableRoles(ApiResourceKind.session),
    ).toEqual([]);
  });
});

describe("the run credential's shape (the service, no store)", () => {
  const service = RunnerAuthService.create(KEY);

  it("carries the execution_scoped type and the binding, and NO exp — its validity is the run's, not a clock's", () => {
    const token = service.mintRunCredential("aex_shape");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload["token_type"]).toBe(TOKEN_TYPE_EXECUTION_SCOPED);
    expect(payload["execution_id"]).toBe("aex_shape");
    expect(typeof payload["iat"]).toBe("number");
    expect(payload).not.toHaveProperty("exp");
  });

  it("verify accepts the run credential and returns its binding — the decrypt lane keeps its binding-equality decision over it", () => {
    expect(service.verify(service.mintRunCredential("aex_shape"))).toBe(
      "aex_shape",
    );
  });

  it("verify still refuses a present exp in the past — the exchange lane's tokens keep their clock", async () => {
    const minted = service.mint("aex_shape", 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(() => service.verify(minted.token)).toThrow();
  });

  it("refuses to mint for an empty binding", () => {
    expect(() => service.mintRunCredential("")).toThrow();
  });
});
