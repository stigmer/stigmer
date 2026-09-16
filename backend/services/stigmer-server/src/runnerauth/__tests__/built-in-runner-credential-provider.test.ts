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
 *     self-host writes is nobody's); a workflow-bound runner is refused
 *     (the cloud refuses every non-session lane); a person is no-opinion
 *     (the gate's own logic applies).
 *
 * Written failing on 2026-09-16, before src/runnerauth/built-in-runner-credential-provider.ts
 * exists; the module that follows turns it green. What the admit's
 * `provedSessionId` carries is that module's design (the capability is synchronous and the
 * session lives on the row, not in the token) and is deliberately not
 * asserted here.
 */
import { randomBytes } from "node:crypto";

import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import type { CallerIdentity } from "../../extensions/identity.js";
import {
  newBuiltInRunnerCredentialProvider,
  runnerBindingOf,
} from "../built-in-runner-credential-provider.js";
import { WORKFLOW_LINEAGE_BINDING_MISMATCH_MESSAGE } from "../constants.js";
import {
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../runnerauth.js";

const KEY = randomBytes(32);
const service = RunnerAuthService.create(KEY);
const provider = newBuiltInRunnerCredentialProvider({ service });

const HUMAN = "ida_carol";

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

  it("does NOT take over the exchange or the bootstrap — those stay the platform controller's OSS arms", () => {
    expect(provider.exchangeScopedToken).toBeUndefined();
    expect(provider.bootstrapCredentials).toBeUndefined();
    expect(provider.mintSandboxCredential).toBeUndefined();
    expect(provider.authorizeExecutionContextRead).toBeUndefined();
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
  const decide = provider.authorizeMemoryCapture!;

  it("an agent-bound runner is admitted, and the memory's subject is the human the verifier resolved", () => {
    const decision = decide(agentBound, "acme");
    expect(decision.verdict).toBe("admit");
    if (decision.verdict === "admit") {
      expect(decision.subjectIdentityAccountId).toBe(HUMAN);
    }
  });

  it("a workflow-bound runner is refused — the cloud refuses every non-session lane", () => {
    expect(decide(workflowBound, "acme")).toEqual({ verdict: "refuse" });
  });

  it("a person is no-opinion — the gate's own eligibility logic applies unchanged", () => {
    expect(decide(person, "acme")).toEqual({ verdict: "no-opinion" });
  });

  it("a runner-class caller whose token this server did not sign is no-opinion, never a throw — the gate then applies its own logic", () => {
    const stranger = runnerCaller(
      RunnerAuthService.create(randomBytes(32)).mintRunCredential("aex_other"),
    );
    expect(decide(stranger, "acme")).toEqual({ verdict: "no-opinion" });
  });
});
