/**
 * InProcessValidator verdict tests — pin the Go validator.go contract: the
 * FAILED nil-spec arm, the fail-fast unknown-kind arm, the INVALID arm
 * carrying the generated YAML plus errors AND warnings, the VALID arm with
 * warnings, the "Failed to generate YAML" fold for converter errors, and
 * the run_workflow refusal reaching the verdict with its YAML.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { createLogger } from "../../../../boot/logger.js";
import { ModelRegistryStore } from "../../registry/model-registry-store.js";
import { InProcessValidator } from "../validator.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const validator = new InProcessValidator(
  new ModelRegistryStore({
    bundledDocument: JSON.stringify({
      models: [{ id: "openai/gpt-6", harness: "native" }],
    }),
    upstreamOrigin: "http://upstream.test",
    refreshEnabled: false,
    logger: silentLogger,
  }),
  silentLogger,
);

function spec(
  tasks: Array<{ name: string; kind: WorkflowTaskKind; taskConfig?: JsonObject; flow?: { then: string } }>,
): WorkflowSpec {
  return create(WorkflowSpecSchema, {
    document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
    tasks,
  });
}

describe("InProcessValidator", () => {
  it("returns FAILED for a nil spec", () => {
    const verdict = validator.validate(undefined);
    expect(verdict.state).toBe(ValidationState.FAILED);
    expect(verdict.errors).toEqual(["WorkflowSpec cannot be nil"]);
    expect(verdict.validatedAt).toBeDefined();
  });

  it("fails fast on unknown task kinds without generating YAML", () => {
    const verdict = validator.validate(
      spec([{ name: "z", kind: 0 as WorkflowTaskKind }]),
    );
    expect(verdict.state).toBe(ValidationState.INVALID);
    expect(verdict.yaml).toBe("");
    expect(verdict.errors).toEqual([
      "task 'z': unknown or unspecified task kind (value=0)",
    ]);
  });

  it("returns INVALID for a run_workflow task, with the YAML the runner would read", () => {
    const verdict = validator.validate(
      spec([
        {
          name: "child",
          kind: WorkflowTaskKind.run_workflow,
          taskConfig: { workflow: "data-enrichment", input: { user_id: "u1" } },
        },
      ]),
    );
    expect(verdict.state).toBe(ValidationState.INVALID);
    expect(verdict.errors).toEqual([
      "task 'child' (run_workflow): running a child workflow is not supported yet — the child name cannot be resolved to a workflow the platform can run",
    ]);
    expect(verdict.yaml).toContain("input:");
    expect(verdict.yaml).not.toContain("with:");
  });

  it("folds converter failures into the INVALID verdict", () => {
    const verdict = validator.validate(
      spec([
        {
          name: "bad",
          kind: WorkflowTaskKind.llm_call,
          taskConfig: { model: "m", prompt: "p", junk: 1 },
        },
      ]),
    );
    expect(verdict.state).toBe(ValidationState.INVALID);
    expect(verdict.errors[0]).toMatch(/^Failed to generate YAML: /);
  });

  it("returns INVALID with the YAML, errors, and warnings all populated", () => {
    const verdict = validator.validate(
      spec([
        {
          name: "l",
          kind: WorkflowTaskKind.llm_call,
          // Unknown fallback (error) + $context.env misuse (warning); no
          // budget (warning).
          taskConfig: {
            model: "openai/gpt-6",
            prompt: "read ${ $context.env.MY_KEY }",
            fallback_task: "missing",
          },
        },
      ]),
    );
    expect(verdict.state).toBe(ValidationState.INVALID);
    expect(verdict.yaml).not.toBe("");
    expect(verdict.errors).toEqual([
      "task 'l' (llm_call) fallback_task references unknown task 'missing'",
    ]);
    expect(verdict.warnings).toContain(
      "Workflow contains cost-incurring tasks (agent_call, llm_call) but no budget limit is set. " +
        "Consider adding a budget to prevent unexpected costs.",
    );
    expect(verdict.warnings.some((w) => w.includes("$context.env.MY_KEY"))).toBe(true);
  });

  it("returns VALID with YAML for a clean spec (warnings allowed)", () => {
    const verdict = validator.validate(
      spec([
        {
          name: "s",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { k: "v" } },
        },
      ]),
    );
    expect(verdict.state).toBe(ValidationState.VALID);
    expect(verdict.yaml).toContain("document:");
    expect(verdict.errors).toEqual([]);
  });

  it("enforces the human-input escalate shape (fail closed, oss#781)", () => {
    const verdict = validator.validate(
      spec([
        {
          name: "gate",
          kind: WorkflowTaskKind.human_input,
          taskConfig: {
            prompt: "p",
            on_timeout: "HUMAN_INPUT_TIMEOUT_ESCALATE",
            outcomes: [{ name: "approve", then: "end" }],
          },
        },
      ]),
    );
    expect(verdict.state).toBe(ValidationState.INVALID);
    expect(verdict.errors).toContain(
      "task 'gate' (human_input): on_timeout policy HUMAN_INPUT_TIMEOUT_ESCALATE requires an outcome named 'escalate' with 'then' set — the timeout resolves to that outcome and follows its 'then' branch",
    );
  });
});
