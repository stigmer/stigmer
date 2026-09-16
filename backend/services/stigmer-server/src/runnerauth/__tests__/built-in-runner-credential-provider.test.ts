/**
 * Pins the built-in RunnerCredentialProvider — the OSS execution-scoped
 * default plus the capabilities an ENFORCING self-host needs, composed
 * under the built-in authorization posture beside the runner-subject
 * verifier (the cloud's shape: one provider object carries the edition's
 * whole credential story). Mint and verify stay byte-identical to the
 * default provider; what this file pins is the two capabilities and the
 * ONE reading of a runner's binding they both read:
 *
 *   - `runnerBindingOf(caller)`: what the caller's credential is bound to
 *     — an agent execution, a workflow execution (the kind read off the
 *     bound id's prefix), or nothing (a person; a token that is not ours;
 *     a forged one). One HMAC, no store read; the lane-admission
 *     decorator asks the same question.
 *   - `vouchRunnerLineageLabels`: a WORKFLOW-bound runner vouches the two
 *     lineage keys for its own workflow execution and REFUSES (the
 *     cloud's byte-pinned copy, transcribed) a stamp naming another; an
 *     agent-bound runner and a person vouch nothing. Without this a
 *     self-host with sign-in on cannot run any workflow that calls an
 *     agent: GuardReservedLabels refuses the child create.
 *   - `authorizeMemoryCapture`: an AGENT-bound runner is ADMITTED with
 *     the human's account id as the memory's subject (the row's one
 *     principal under the model — without it every memory an enforcing
 *     self-host writes is nobody's) and the run's SESSION as the proved
 *     provenance, read off the execution row (the cloud reads it off its
 *     session-scoped token; ours names only the execution); a capture
 *     addressed to an org that is not the run's is refused with the
 *     cloud's copy; a workflow-bound runner is refused (the cloud refuses
 *     every non-session lane); a person is no-opinion (the gate's own
 *     logic applies).
 *   - `exchangeScopedToken` (2026-09-16, the mint gate): the execution
 *     arms mint the RUN credential (no `exp`, expiresInSeconds 0) for
 *     the run's own person and nobody else — a missing row is NOT_FOUND
 *     with the load-first copy, any other caller (a run stamped by nobody
 *     included) is PERMISSION_DENIED with one sentence; the kind read is
 *     the id's, not the arm's; pool-claim, renewal and unset answer
 *     not-minted; so does keyless. Under trusted-local the controller's
 *     own arms mint for anyone, and this capability does not exist.
 *
 * Written failing on 2026-09-16, before src/runnerauth/built-in-runner-credential-provider.ts
 * existed; the module turned it green.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { AccountsByCaller } from "../../domain/identityaccount/resolve.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { BoundExecutionStore } from "../bound-execution.js";
import {
  newBuiltInRunnerCredentialProvider,
  runnerBindingOf,
} from "../built-in-runner-credential-provider.js";
import {
  MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE,
  RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE,
  WORKFLOW_LINEAGE_BINDING_MISMATCH_MESSAGE,
} from "../constants.js";
import type { RunnerScopedTokenExchange } from "../runner-credential-provider.js";
import {
  isClockedToken,
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../runnerauth.js";

const KEY = randomBytes(32);
const service = RunnerAuthService.create(KEY);

const HUMAN = "ida_carol";
const OTHER = "ida_bruce";

/** The creator stamp as the store writes it (status.audit.spec_audit.created_by.id). */
function stampedBy(id: string) {
  return { audit: { specAudit: { createdBy: { id } } } };
}

/** The one agent execution the capture arms read: Carol's run in `acme`, on session `ses_carol`. */
const AGENT_RUN = create(AgentExecutionSchema, {
  metadata: { id: "aex_agent_run", name: "aex_agent_run", org: "acme" },
  spec: { sessionId: "ses_carol" },
  status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS, ...stampedBy(HUMAN) },
});

/** Carol's workflow execution — the exchange's workflow arm reads it. */
const WORKFLOW_RUN = create(WorkflowExecutionSchema, {
  metadata: { id: "wex_carols_flow", name: "wex_carols_flow", org: "acme" },
  status: { ...stampedBy(HUMAN) },
});

/** A run created before sign-in was on: its stamp names nobody the server recognizes. */
const NOBODYS_RUN = create(AgentExecutionSchema, {
  metadata: { id: "aex_nobodys_run", name: "aex_nobodys_run", org: "acme" },
  spec: { sessionId: "ses_old" },
  status: {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    ...stampedBy("system"),
  },
});

const ROWS: Record<string, unknown> = {
  aex_agent_run: AGENT_RUN,
  wex_carols_flow: WORKFLOW_RUN,
  aex_nobodys_run: NOBODYS_RUN,
};

/** A store that knows three rows and answers the typed not-found for every other id. */
const store: BoundExecutionStore = {
  getResource<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    _schema: Desc,
  ): Promise<MessageShape<Desc>> {
    const row = ROWS[id];
    if (row === undefined) {
      return Promise.reject(new ResourceNotFoundError(`${kind}/${id}`));
    }
    return Promise.resolve(row as MessageShape<Desc>);
  },
};

/** Two accounts by id; nothing resolves by raw subject (the pre-3.15.0 shape is not exercised here). */
const accounts: AccountsByCaller = {
  async findById(id: string): Promise<IdentityAccount | undefined> {
    return id === HUMAN || id === OTHER
      ? create(IdentityAccountSchema, { metadata: { id, name: id } })
      : undefined;
  },
  async findDirectByIdpId(): Promise<IdentityAccount | undefined> {
    return undefined;
  },
};

const provider = newBuiltInRunnerCredentialProvider({
  service,
  store,
  accounts,
});

/** The identity the runner-subject verifier mints for a run credential. */
function runnerCaller(rawToken: string): CallerIdentity {
  return {
    identityId: HUMAN,
    callerClass: "runner",
    issuer: "",
    rawToken,
    email: "carol@example.com",
    displayName: "Carol Danvers",
  };
}

/** A person on the wire — the OIDC or API-key verifier's identity. */
const person: CallerIdentity = {
  identityId: HUMAN,
  callerClass: "user",
  issuer: "https://issuer.example.com/",
  rawToken: "eyJ.person.token",
};

const agentBound = runnerCaller(service.mintRunCredential("aex_agent_run"));
const workflowBound = runnerCaller(
  service.mintRunCredential("wex_workflow_run"),
);

describe("the default lane is byte-identical", () => {
  it("mints and verifies on execution_scoped exactly as the default provider", () => {
    const minted = provider.mint(TOKEN_TYPE_EXECUTION_SCOPED, "aex_prov", 0);
    expect(provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, minted.token)).toBe(
      "aex_prov",
    );
    expect(provider.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)).toBe(true);
    expect(provider.isEnabled("sandbox")).toBe(false);
  });

  it("carries the default's run-credential capability unchanged — the dispatch mints through it", () => {
    const token = provider.mintRunCredential!("aex_dispatch");
    expect(provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, token)).toBe(
      "aex_dispatch",
    );
    expect(isClockedToken(token)).toBe(false);
  });

  it("does NOT take over the bootstrap, the sandbox mint or the decrypt decision — those stay the OSS arms", () => {
    expect(provider.bootstrapCredentials).toBeUndefined();
    expect(provider.mintSandboxCredential).toBeUndefined();
    expect(provider.authorizeExecutionContextRead).toBeUndefined();
  });
});

describe("exchangeScopedToken — the mint gate", () => {
  const exchange = (
    request: Parameters<NonNullable<typeof provider.exchangeScopedToken>>[0],
    caller: CallerIdentity,
  ): Promise<RunnerScopedTokenExchange> =>
    provider.exchangeScopedToken!(request, caller);

  const carol: CallerIdentity = {
    identityId: HUMAN,
    callerClass: "user",
    issuer: "https://issuer.example.com/",
    rawToken: "eyJ.carol.token",
  };
  const bruce: CallerIdentity = {
    ...carol,
    identityId: OTHER,
    rawToken: "eyJ.bruce.token",
  };

  async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
    const failure = await promise.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    return failure as ConnectError;
  }

  it("mints the RUN credential for the run's own person: bound to the execution, no clock, no expiry on the wire", async () => {
    const minted = await exchange(
      { arm: "agent-execution", executionId: "aex_agent_run" },
      carol,
    );
    expect(minted.minted).toBe(true);
    if (!minted.minted) throw new Error("unreachable");
    expect(service.verify(minted.token)).toBe("aex_agent_run");
    expect(isClockedToken(minted.token)).toBe(false);
    expect(minted.expiresInSeconds).toBe(0);
  });

  it("the workflow-execution arm mints the same way for the workflow's person", async () => {
    const minted = await exchange(
      { arm: "workflow-execution", executionId: "wex_carols_flow" },
      carol,
    );
    expect(minted.minted).toBe(true);
    if (!minted.minted) throw new Error("unreachable");
    expect(service.verify(minted.token)).toBe("wex_carols_flow");
  });

  it("another signed-in person is refused with one sentence — the impersonation path this gate closes", async () => {
    const failure = await refusal(
      exchange({ arm: "agent-execution", executionId: "aex_agent_run" }, bruce),
    );
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE);
    expect(RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE).toBe(
      "a run credential is minted only for the person whose run it is",
    );
  });

  it("a run whose creator stamp names nobody is nobody's to hold — refused with the same sentence", async () => {
    const failure = await refusal(
      exchange(
        { arm: "agent-execution", executionId: "aex_nobodys_run" },
        carol,
      ),
    );
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE);
  });

  it("a run that does not exist is NOT_FOUND with the load-first copy — what a `get` on that id answers", async () => {
    const failure = await refusal(
      exchange({ arm: "agent-execution", executionId: "aex_missing" }, carol),
    );
    expect(failure.code).toBe(Code.NotFound);
    expect(failure.rawMessage).toBe("AgentExecution not found: aex_missing");

    const workflowFailure = await refusal(
      exchange(
        { arm: "workflow-execution", executionId: "wex_missing" },
        carol,
      ),
    );
    expect(workflowFailure.rawMessage).toBe(
      "WorkflowExecution not found: wex_missing",
    );
  });

  it("the id decides which execution is read, never the arm — an agent id under the workflow arm mints for the agent run", async () => {
    const minted = await exchange(
      { arm: "workflow-execution", executionId: "aex_agent_run" },
      carol,
    );
    expect(minted.minted).toBe(true);
    if (!minted.minted) throw new Error("unreachable");
    expect(service.verify(minted.token)).toBe("aex_agent_run");
  });

  it("a runner already acting as the person may hold a credential for that person's other run (the credential's reach, pinned as a known fact)", async () => {
    const minted = await exchange(
      { arm: "agent-execution", executionId: "aex_agent_run" },
      runnerCaller(service.mintRunCredential("wex_carols_flow")),
    );
    expect(minted.minted).toBe(true);
  });

  it.each([
    ["pool-claim", { arm: "pool-claim", sessionId: "ses_x" } as const],
    ["renewal", { arm: "renewal" } as const],
    ["unset", { arm: "unset" } as const],
    [
      "an empty execution id",
      { arm: "agent-execution", executionId: "" } as const,
    ],
  ])(
    "%s answers not-minted — the controller's arms, verbatim",
    async (_label, request) => {
      expect(await exchange(request, carol)).toEqual({ minted: false });
    },
  );

  it("keyless answers not-minted — degraded, never an error", async () => {
    const keyless = newBuiltInRunnerCredentialProvider({
      service: RunnerAuthService.create(undefined),
      store,
      accounts,
    });
    expect(
      await keyless.exchangeScopedToken!(
        { arm: "agent-execution", executionId: "aex_agent_run" },
        carol,
      ),
    ).toEqual({ minted: false });
  });
});

describe("runnerBindingOf — the one reading of what a runner is bound to", () => {
  it("an agent-bound run credential", () => {
    expect(runnerBindingOf(service, agentBound)).toEqual({
      kind: "agent-execution",
      executionId: "aex_agent_run",
    });
  });

  it("a workflow-bound run credential", () => {
    expect(runnerBindingOf(service, workflowBound)).toEqual({
      kind: "workflow-execution",
      executionId: "wex_workflow_run",
    });
  });

  it("the exchange lane's clocked token binds the same way", () => {
    const clocked = runnerCaller(service.mint("aex_clocked", 300).token);
    expect(runnerBindingOf(service, clocked)?.executionId).toBe("aex_clocked");
  });

  it.each([
    ["a person", person],
    ["a runner-class caller holding no token", { ...agentBound, rawToken: "" }],
    [
      "a runner-class caller holding a token this server did not sign",
      runnerCaller(
        RunnerAuthService.create(randomBytes(32)).mintRunCredential(
          "aex_other",
        ),
      ),
    ],
    [
      "a token bound to an id whose prefix names no execution kind",
      runnerCaller(service.mintRunCredential("ses_not_an_execution")),
    ],
  ])(
    "%s is not a runner binding (undefined) — never a throw",
    (_label, caller) => {
      expect(runnerBindingOf(service, caller)).toBeUndefined();
    },
  );
});

describe("vouchRunnerLineageLabels", () => {
  const vouch = provider.vouchRunnerLineageLabels!;

  it("a workflow-bound runner vouches the lineage keys for ITS workflow execution", () => {
    expect(vouch(workflowBound, "wex_workflow_run")).toBe(true);
  });

  it("a workflow-bound runner vouches when the request stamped only the task label (no binding to check)", () => {
    expect(vouch(workflowBound, "")).toBe(true);
  });

  it("a workflow-bound runner naming ANOTHER workflow's lineage is refused with the cloud's copy — a workflow sandbox cannot stamp another workflow's lineage", () => {
    let failure: unknown;
    try {
      vouch(workflowBound, "wex_someone_elses");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    expect((failure as ConnectError).rawMessage).toBe(
      WORKFLOW_LINEAGE_BINDING_MISMATCH_MESSAGE,
    );
    expect(WORKFLOW_LINEAGE_BINDING_MISMATCH_MESSAGE).toBe(
      "workflow lineage label names a workflow execution this runner credential is not bound to",
    );
  });

  it("an agent-bound runner vouches nothing — a subagent create carrying lineage keys stays subject to the guard", () => {
    expect(vouch(agentBound, "wex_workflow_run")).toBe(false);
  });

  it("a person vouches nothing", () => {
    expect(vouch(person, "wex_workflow_run")).toBe(false);
  });
});

describe("authorizeMemoryCapture", () => {
  const decide = (caller: CallerIdentity, org: string) =>
    Promise.resolve(provider.authorizeMemoryCapture!(caller, org));

  it("an agent-bound runner is admitted: the memory's subject is the human the verifier resolved, the proved session is the run's", async () => {
    expect(await decide(agentBound, "acme")).toEqual({
      verdict: "admit",
      subjectIdentityAccountId: HUMAN,
      provedSessionId: "ses_carol",
    });
  });

  it("an empty capture org is admitted — the org-required refusal belongs to the defaults step (the cloud's check order)", async () => {
    expect((await decide(agentBound, "")).verdict).toBe("admit");
  });

  it("a capture addressed to an org that is not the run's is refused with the cloud's copy — a forged address, not a routing choice", async () => {
    const failure = await decide(agentBound, "someone-elses-org").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.PermissionDenied);
    expect((failure as ConnectError).rawMessage).toBe(
      MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE,
    );
    expect(MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE).toBe(
      "memory capture is scoped to the session's organization",
    );
  });

  it("a workflow-bound runner is refused — the cloud refuses every non-session lane", async () => {
    expect(await decide(workflowBound, "acme")).toEqual({ verdict: "refuse" });
  });

  it("an agent-bound runner whose run has vanished is refused — a memory the server cannot attribute is not written as nobody's", async () => {
    const orphan = runnerCaller(service.mintRunCredential("aex_vanished"));
    expect(await decide(orphan, "acme")).toEqual({ verdict: "refuse" });
  });

  it("a person is no-opinion — the gate's own eligibility logic applies unchanged", async () => {
    expect(await decide(person, "acme")).toEqual({ verdict: "no-opinion" });
  });

  it("a runner-class caller whose token this server did not sign is no-opinion, never a throw — the gate then applies its own logic", async () => {
    const stranger = runnerCaller(
      RunnerAuthService.create(randomBytes(32)).mintRunCredential("aex_other"),
    );
    expect(await decide(stranger, "acme")).toEqual({ verdict: "no-opinion" });
  });
});
