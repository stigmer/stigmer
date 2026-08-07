// Conformance suite for AgentExecution create-time validation (CRUD-level).
// Domain: agentic / agentexecution — the request-shape contract that fires
// before any resource resolution, engine contact, or side effect.
//
// This file exists separately from the execution-engine suite
// (suites-execution/agentexecution.conformance.test.ts) because of how the
// suites are targeted: src/suites/** runs against every edition — including
// `npm run test:cloud` — while suites-execution/** needs a provisioned engine
// (Temporal + runner + mock LLM) and only runs against the local Go execution
// target. Validation is step 1 of both editions' create pipelines, so these
// rejections are provable on any target with fake IDs and no engine — and
// keeping them here is what makes the cloud (Java) edition's protovalidate
// enforcement a gated contract rather than an assumption.
//
// Positive bootstrap behavior (spec forwarding, resolution precedence,
// single-source-of-truth clearing) needs a live engine and stays in the
// execution suite.
import { Code } from "@connectrpc/connect";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { makeAgentExecution } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

describe("AgentExecution conformance — one-call session bootstrap validation (session_spec)", () => {
  it("rejects session_id and session_spec together (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Validation fires before any resource resolution, so fake ids suffice.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-bootstrap-exclusive"),
            sessionId: "ses_existing",
            sessionSpec: { agentInstanceId: "ain_1" },
          }),
        ),
      Code.InvalidArgument,
      "create with both session_id and session_spec",
    );
  });

  it("rejects a session_spec carrying harness_state_id (InvalidArgument — server-owned field)", async () => {
    const { org } = await target.provisionTenancy();
    // harness_state_id is engine-owned conversation continuity state; a
    // caller-supplied value would fake state on a brand-new session and trip
    // the immutability sentinel.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-bootstrap-hstate"),
            sessionSpec: { agentInstanceId: "ain_1", harnessStateId: "thread-forged" },
          }),
        ),
      Code.InvalidArgument,
      "create with a session_spec carrying harness_state_id",
    );
  });
});

describe("AgentExecution conformance — service-tier fail-closed validation (#357)", () => {
  // The tier exists to make pricing deterministic, so it is validated where
  // the price is decided — at create, against the model registry — with
  // identical rules and messages in both editions (OSS Go
  // validateServiceTierStep, cloud Java ValidateServiceTierStep). Both
  // refusals fire before any resource resolution, so fake ids suffice.

  it("rejects fast without a pinned model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-tier-no-model"),
            agentId: "agt_fake",
            executionConfig: { serviceTier: ServiceTier.FAST },
          }),
        ),
      Code.InvalidArgument,
      "create with service_tier fast and no model_name",
    );
  });

  it("rejects fast on a model with no registry fast variant (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // claude-haiku-4-5 is registered but prices no fast variant — selecting
    // a tier billing cannot price would trip the undercharge guard, so
    // selection and billability are coupled by refusing here.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-tier-unpriced"),
            agentId: "agt_fake",
            executionConfig: {
              modelName: "claude-haiku-4-5",
              serviceTier: ServiceTier.FAST,
            },
          }),
        ),
      Code.InvalidArgument,
      "create with service_tier fast on a model without a fast variant",
    );
  });
});
