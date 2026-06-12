// Canonical valid ExecutionContext fixtures for the conformance suite.
// Domain: conformance support.
//
// ExecutionContext is the execution-scoped, flat resource the engine creates to
// carry a single run's merged runtime configuration and secrets. Its spec pairs
// a required `execution_id` (the parent AgentExecution/WorkflowExecution id) with
// a `data` map of ExecutionValue entries (value + is_secret; no description,
// unlike EnvironmentValue).
//
// In normal operation the engine creates the context after envmerge runs; here
// we exercise the resource's own API contract directly. There is no foreign-key
// check on execution_id, so a synthetic id is sufficient for the lookup tests.
//
// As with support/environments.ts, the canonical builder is SECRET-FREE so the
// create-vs-get parity check stays edition-stable; secret entries are opt-in via
// `data` for the dedicated secret tests. Negatives are composed inline.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";

export const EXECUTION_CONTEXT_API_VERSION = "agentic.stigmer.ai/v1";
export const EXECUTION_CONTEXT_KIND = "ExecutionContext";

// A single spec.data entry: the runtime value and whether it is a secret.
export interface ExecutionValueInit {
  value: string;
  isSecret?: boolean;
}

export interface ExecutionContextSpecOptions {
  // Parent execution id. Required (min_len=1); defaults to a synthetic id.
  executionId?: string;
  // spec.data entries keyed by variable name. Defaults to one plain (non-secret)
  // variable so the canonical context is parity-stable across editions.
  data?: Record<string, ExecutionValueInit>;
}

// A valid ExecutionContextSpec. By default it carries one plain variable; pass
// `data` to compose plain and/or secret entries for the secret-handling tests.
export function makeExecutionContextSpec(
  opts: ExecutionContextSpecOptions = {},
): MessageInitShape<typeof ExecutionContextSpecSchema> {
  const data = opts.data ?? { PLAIN_KEY: { value: "plain-value" } };
  return {
    executionId: opts.executionId ?? "aex_conformance_fixture",
    data: Object.fromEntries(
      Object.entries(data).map(([key, entry]) => [key, { value: entry.value, isSecret: entry.isSecret ?? false }]),
    ),
  };
}

export interface ExecutionContextOptions extends ExecutionContextSpecOptions {
  org: string;
  name: string;
}

// A complete, valid ExecutionContext resource ready to hand to create/apply.
export function makeExecutionContext(opts: ExecutionContextOptions): MessageInitShape<typeof ExecutionContextSchema> {
  const { org, name, executionId, data } = opts;
  return {
    apiVersion: EXECUTION_CONTEXT_API_VERSION,
    kind: EXECUTION_CONTEXT_KIND,
    metadata: { name, org },
    spec: makeExecutionContextSpec({ executionId, data }),
  };
}
