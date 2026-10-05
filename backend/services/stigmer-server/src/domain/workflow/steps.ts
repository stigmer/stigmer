/**
 * Workflow domain pipeline steps — port the step half of
 * pkg/domain/workflow/controller: the Layer-2 validation gate
 * (validate_spec_step.go), status population
 * (populate_serverless_validation_step.go), the version hash
 * (the rest of the version machinery is the shared one in
 * pipeline/steps/version-archive.ts, bound in version-resolution.ts).
 * Proven by workflow.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/workflow.test.ts.
 */
import { clone, create } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/status_pb";
import { ApiResourceMetadataVersionSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { ServerlessWorkflowValidation } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import {
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { canonicalSpecHash } from "../../pipeline/steps/spec-hash.js";
import { VERSION_HASH_KEY } from "../../pipeline/steps/version-archive.js";
import { truncateHash } from "../../pipeline/steps/version-history.js";
import type { InProcessValidator } from "./validation/validator.js";

type WorkflowDesc = typeof WorkflowSchema;

// Context keys — identical strings to Go's so the inventory's step notes
// read straight onto this code.
export const SERVERLESS_VALIDATION_KEY = "serverless_validation";
export { VERSION_HASH_KEY };

// ---------------------------------------------------------------------------
// ValidateWorkflowSpec — validate_spec_step.go: the Create/Update
// persist-path validation gate. Layer 2 (proto → CNCF YAML + structural
// checks) runs produce-and-gate:
//   1. Produce: the verdict lands in context under SERVERLESS_VALIDATION_KEY
//      so PopulateServerlessValidation can persist the generated YAML and
//      state onto WorkflowStatus.
//   2. Gate: any non-VALID state aborts the pipeline — an invalid workflow
//      must never be persisted.
// This produce-and-gate behavior is exactly why validateSpec (the RPC) does
// NOT reuse this step: it must RETURN the structured verdict for INVALID
// specs rather than abort (controller.ts).
//
// Go carries a nil-validator warn-and-skip arm from its two-phase wiring;
// the validator here is constructor-injected and cannot be absent, so that
// arm has no equivalent.
// ---------------------------------------------------------------------------

export function newValidateWorkflowSpecStep(
  validator: InProcessValidator,
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "ValidateWorkflowSpec",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const workflow = ctx.input;

      // Workflow.spec is not marked required at the proto level
      // (protovalidate cannot catch it), so a spec-less create reaches this
      // step. It is a client input error, hence InvalidArgument.
      if (workflow.spec === undefined) {
        throw invalidArgumentError("workflow spec is required");
      }

      logger.debug("Layer 2: in-process validation (converts + validates)");

      let verdict: ServerlessWorkflowValidation;
      try {
        verdict = validator.validate(workflow.spec);
      } catch (error) {
        logger.error("Layer 2: validation execution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw internalError(error, "workflow validation system error");
      }

      ctx.set(SERVERLESS_VALIDATION_KEY, verdict);

      switch (verdict.state) {
        case ValidationState.VALID:
          logger.info("Layer 2: validation passed (state: VALID)", {
            warnings: verdict.warnings.length,
          });
          return;

        case ValidationState.INVALID: {
          logger.warn("Layer 2: validation failed (state: INVALID)", {
            errors: verdict.errors.length,
            warnings: verdict.warnings.length,
          });
          const errorMessage =
            verdict.errors.length > 0
              ? verdict.errors[0]!
              : "workflow structure validation failed";
          throw invalidArgumentError(
            `workflow validation failed: ${errorMessage}`,
          );
        }

        case ValidationState.FAILED: {
          logger.error("Layer 2: validation system error (state: FAILED)", {
            errors: verdict.errors.length,
          });
          const systemError =
            verdict.errors.length > 0
              ? verdict.errors[0]!
              : "validation system encountered an error";
          throw internalError(
            new Error(systemError),
            "workflow validation system error",
          );
        }

        default:
          logger.error("Layer 2: unknown validation state", {
            state: verdict.state,
          });
          throw internalError(
            new Error(String(verdict.state)),
            "workflow validation returned unknown state",
          );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// PopulateServerlessValidation — populate_serverless_validation_step.go:
// copies the verdict from context into
// workflow.status.serverless_workflow_validation so the generated CNCF YAML
// travels with the workflow (execution hydration reads it). Only VALID
// verdicts reach this step (INVALID/FAILED aborted the pipeline earlier).
// The create variant warn-skips an absent verdict; the update variant
// errors on a wrong-typed one (update always re-validates).
// ---------------------------------------------------------------------------

export function newPopulateServerlessValidationStep(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "PopulateServerlessValidation",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const wf = ctx.newState;
      const verdict = ctx.get(SERVERLESS_VALIDATION_KEY) as
        | ServerlessWorkflowValidation
        | undefined;
      if (verdict === undefined) {
        logger.warn(
          "serverless validation result not found in context - skipping population",
          { workflowId: wf.metadata?.id ?? "" },
        );
        return;
      }

      wf.status ??= create(WorkflowStatusSchema);
      wf.status.serverlessWorkflowValidation = verdict;
      ctx.setNewState(wf);
    },
  };
}

export function newPopulateServerlessValidationStepForUpdate(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "PopulateServerlessValidation",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const wf = ctx.newState;
      const raw = ctx.get(SERVERLESS_VALIDATION_KEY);
      if (raw === undefined) {
        logger.warn(
          "serverless validation result not found in context - validator may be disabled",
          { workflowId: wf.metadata?.id ?? "" },
        );
        return;
      }
      const verdict = raw as ServerlessWorkflowValidation;

      wf.status ??= create(WorkflowStatusSchema);
      wf.status.serverlessWorkflowValidation = verdict;
      ctx.setNewState(wf);

      logger.debug("refreshed serverless validation on update", {
        workflowId: wf.metadata?.id ?? "",
        yamlLength: verdict.yaml.length,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The version hash. A workflow version is everything a run reads from its
// workflow: the task list the runner executes, each step's environments
// the server resolves for an agent_call turn, the declared env and the
// budget. So the hash is the canonical hash of the whole spec — the
// function agents use (pipeline/steps/spec-hash.ts) — not the hash of the
// generated YAML, which omits a step's environment_refs, the env
// declarations and the budget, so an edit to them under a YAML hash left
// the version unchanged and a running step read the edited refs
// (stigmer#1906).
//
// The one exception is spec.execution_visibility, the run audience: it is
// cleared before hashing, so changing who sees the runs mints no version.
//
// The hash is taken only when validation produced YAML (a VALID verdict),
// so a version always names a valid workflow. A workflow last saved under
// the YAML hash mints one version at its next save, even unchanged: no
// migration rewrites hashes, because runs are pinned to them and their
// audit rows keep answering.
// ---------------------------------------------------------------------------

/**
 * The version hash of a workflow spec: its canonical hash with the run
 * audience cleared. Pure; the caller's spec is never mutated.
 */
export function workflowVersionHash(spec: WorkflowSpec): string {
  const versioned = clone(WorkflowSpecSchema, spec);
  versioned.executionVisibility = WorkflowExecutionVisibility.unspecified;
  return canonicalSpecHash(WorkflowSpecSchema, versioned);
}

/** The spec's version hash, stashed under VERSION_HASH_KEY once validation produced YAML. */
export function newComputeVersionHashStep(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "ComputeVersionHash",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const yaml =
        ctx.newState.status?.serverlessWorkflowValidation?.yaml ?? "";
      const spec = ctx.newState.spec;
      if (yaml === "" || spec === undefined) {
        logger.debug(
          "no YAML in validation status — skipping version hash computation",
        );
        return;
      }

      const hexHash = workflowVersionHash(spec);
      ctx.set(VERSION_HASH_KEY, hexHash);

      logger.debug("computed workflow version hash", {
        versionHash: truncateHash(hexHash),
      });
    },
  };
}
