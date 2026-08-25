/**
 * Workflow domain pipeline steps — port the step half of
 * pkg/domain/workflow/controller: the Layer-2 validation gate
 * (validate_spec_step.go), status population
 * (populate_serverless_validation_step.go), the content-addressed version
 * machinery (version_steps.go — hash chain, #341 head-repoint, tag
 * single-holder, audit-failure revert invariant), default-instance
 * choreography (create.go), and the #592 instance cascade
 * (delete_cascade.go). Proven by workflow.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts) and __tests__/workflow.test.ts.
 */
import { createHash } from "node:crypto";
import { ConnectError } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/status_pb";
import { ApiResourceMetadataVersionSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { ServerlessWorkflowValidation } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { buildDefaultWorkflowInstanceRequest } from "../workflowinstance/defaultinstance.js";
import type { InProcessValidator } from "./validation/validator.js";

type WorkflowDesc = typeof WorkflowSchema;

// Context keys — identical strings to Go's so the inventory's step notes
// read straight onto this code.
export const SERVERLESS_VALIDATION_KEY = "serverless_validation";
export const VERSION_HASH_KEY = "version_hash";
export const VERSION_CHANGED_KEY = "version_changed";
export const DEFAULT_INSTANCE_ID_KEY = "default_instance_id";

// ---------------------------------------------------------------------------
// The workflowinstance in-process edge (DD-002): workflow create provisions
// the default instance through the full interceptor chain. Go's
// CreateAsSystem is the Create RPC under the process-global operator
// identity, so a plain create IS the system-actor create in this edition.
// ---------------------------------------------------------------------------

export interface WorkflowInstanceCreator {
  createAsSystem(instance: WorkflowInstance): Promise<WorkflowInstance>;
}

/**
 * Lazy provider for the workflow↔workflowinstance true cycle — resolved at
 * call time, never at construction (the ratified DI story, D2 §2).
 */
export type WorkflowInstanceCreatorProvider = () => WorkflowInstanceCreator;

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
// Version machinery — version_steps.go. The hash is deterministic because
// the converter renders canonically (DD-B): same workflow spec = same YAML
// = same hash.
// ---------------------------------------------------------------------------

/** SHA-256 of the generated CNCF YAML, stashed under VERSION_HASH_KEY. */
export function newComputeVersionHashStep(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "ComputeVersionHash",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const yaml =
        ctx.newState.status?.serverlessWorkflowValidation?.yaml ?? "";
      if (yaml === "") {
        logger.debug(
          "no YAML in validation status — skipping version hash computation",
        );
        return;
      }

      const hexHash = createHash("sha256").update(yaml).digest("hex");
      ctx.set(VERSION_HASH_KEY, hexHash);

      logger.debug("computed workflow version hash", {
        versionHash: truncateHash(hexHash),
        yamlLength: yaml.length,
      });
    },
  };
}

/**
 * Compares the new hash against status.version_hash so downstream steps
 * (audit, metadata) skip work when the spec hasn't actually changed
 * (idempotent applies).
 */
export function newCheckVersionChangedStep(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "CheckVersionChanged",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const newHash = (ctx.get(VERSION_HASH_KEY) as string | undefined) ?? "";
      if (newHash === "") {
        ctx.set(VERSION_CHANGED_KEY, false);
        return;
      }

      const existingHash = ctx.newState.status?.versionHash ?? "";
      const changed = newHash !== existingHash;
      ctx.set(VERSION_CHANGED_KEY, changed);

      if (changed) {
        logger.debug("workflow version changed", {
          oldHash: truncateHash(existingHash),
          newHash: truncateHash(newHash),
        });
      } else {
        logger.debug("workflow version unchanged — skipping audit", {
          hash: truncateHash(newHash),
        });
      }
    },
  };
}

/**
 * Writes the computed hash into status.version_hash and the
 * metadata.version id/previous_version_id chain. On create: always. On
 * update: only when VERSION_CHANGED_KEY is true.
 */
export function newPopulateVersionHashStep(
  isCreate: boolean,
): PipelineStep<WorkflowDesc> {
  return {
    name: "PopulateVersionHash",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const newHash = (ctx.get(VERSION_HASH_KEY) as string | undefined) ?? "";
      if (newHash === "") {
        return;
      }
      if (!isCreate && ctx.get(VERSION_CHANGED_KEY) !== true) {
        return;
      }

      const wf = ctx.newState;
      wf.status ??= create(WorkflowStatusSchema);
      const previousHash = wf.status.versionHash;
      wf.status.versionHash = newHash;

      if (wf.metadata !== undefined) {
        wf.metadata.version ??= create(ApiResourceMetadataVersionSchema);
        wf.metadata.version.id = newHash;
        wf.metadata.version.previousVersionId = previousHash;
      }

      ctx.setNewState(wf);
    },
  };
}

/**
 * Archives the workflow to the resource_audit table (version_steps.go
 * saveVersionAuditStep). On create: always (the first version). On update:
 * only when the version changed (idempotent).
 *
 * Rollback applies repoint, never duplicate (oss#341): when the caller
 * re-applies a prior version's spec, the canonical rendering reproduces
 * that version's hash, so the content is already archived. Versions are
 * content-addressed identities — one content, one history entry — so the
 * head simply repoints to the existing row (the hash chain was already set
 * by PopulateVersionHash) and only the tag assignment still runs.
 * Inserting again would give the tag single-holder UPDATE two targets. An
 * unexpected lookup failure degrades to archiving anyway: a possible
 * duplicate row beats a failed apply.
 *
 * On archive failure the version hash is stripped from the workflow so a
 * set hash always resolves to an audit entry (the revert invariant);
 * persistOnRevert re-persists when this step runs AFTER the final persist
 * (the create path archives last so default_instance_id is captured; the
 * update path has a Persist step following that flushes the revert).
 */
export function newSaveVersionAuditStep(
  store: Store,
  logger: Logger,
  isCreate: boolean,
  persistOnRevert: boolean,
): PipelineStep<WorkflowDesc> {
  return {
    name: "SaveVersionAudit",
    async execute(ctx: RequestContext<WorkflowDesc>): Promise<void> {
      if (!isCreate && ctx.get(VERSION_CHANGED_KEY) !== true) {
        return;
      }

      const wf = ctx.newState;
      const versionHash = wf.status?.versionHash ?? "";
      if (versionHash === "") {
        return;
      }

      const tag = wf.metadata?.version?.tag ?? "";
      const workflowId = wf.metadata?.id ?? "";
      const kind =
        ctx.apiResourceKind !== ApiResourceKind.api_resource_kind_unknown
          ? ctx.apiResourceKind
          : ApiResourceKind.workflow;

      let alreadyArchived = false;
      try {
        await store.getAuditByHash(kind, workflowId, versionHash, WorkflowSchema);
        alreadyArchived = true;
      } catch (error) {
        if (!(error instanceof AuditNotFoundError)) {
          logger.warn(
            "could not check for an existing archived version — archiving anyway",
            {
              error: error instanceof Error ? error.message : String(error),
              workflowId,
              versionHash: truncateHash(versionHash),
            },
          );
        }
      }

      if (!alreadyArchived) {
        // Archive the snapshot TAGLESS. The tag lives only in the audit tag
        // column (the source of truth), assigned below through the
        // single-holder primitive. Snapshot blobs are never the tag's home,
        // so a later tag move never rewrites this immutable content.
        try {
          await store.saveAudit(kind, workflowId, WorkflowSchema, wf, versionHash, "");
        } catch (error) {
          logger.error(
            "failed to save workflow version audit — reverting version hash to maintain audit-resolvability invariant",
            {
              error: error instanceof Error ? error.message : String(error),
              workflowId,
              versionHash: truncateHash(versionHash),
            },
          );

          // Revert: clear the hash so the persisted workflow doesn't
          // reference an audit entry that doesn't exist. The workflow is
          // still created/updated successfully, just without version
          // tracking for this apply.
          wf.status!.versionHash = "";
          if (wf.metadata?.version !== undefined) {
            wf.metadata.version.id = "";
          }
          ctx.setNewState(wf);

          if (persistOnRevert) {
            try {
              await store.saveResource(kind, workflowId, WorkflowSchema, wf);
            } catch (persistError) {
              logger.error("failed to re-persist workflow after reverting version hash", {
                error:
                  persistError instanceof Error
                    ? persistError.message
                    : String(persistError),
                workflowId,
              });
            }
          }
          return;
        }
      }

      // Assign the requested tag through setAuditTag — the ONE primitive
      // shared with the tagVersion RPC — so apply-time tagging obeys the
      // same single-holder invariant (a tag names exactly one version).
      if (tag !== "") {
        try {
          await store.setAuditTag(kind, workflowId, versionHash, tag);
        } catch (error) {
          logger.error(
            "archived version but failed to assign its tag — clearing the live tag to stay consistent with the audit column",
            {
              error: error instanceof Error ? error.message : String(error),
              workflowId,
              versionHash: truncateHash(versionHash),
              tag,
            },
          );
          // The audit head is now untagged; keep the live head consistent
          // so get / getByReference never advertise a tag the store cannot
          // resolve.
          if (wf.metadata?.version !== undefined) {
            wf.metadata.version.tag = "";
            ctx.setNewState(wf);
          }
        }
      }

      if (alreadyArchived) {
        logger.info(
          "version content already archived — repointed head without a new history row",
          { workflowId, versionHash: truncateHash(versionHash), tag },
        );
      } else {
        logger.info("archived workflow version to audit history", {
          workflowId,
          versionHash: truncateHash(versionHash),
          tag,
        });
      }
    },
  };
}

export function truncateHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) + "..." : hash;
}

// ---------------------------------------------------------------------------
// Default-instance choreography — create.go: the instance is created via
// the in-process client AFTER Persist (children need the parent's id), then
// the workflow's status.default_instance_id is written in an explicit
// second persist (separated so the extra database write is visible in the
// pipeline).
// ---------------------------------------------------------------------------

export function newCreateDefaultInstanceStep(
  creatorProvider: WorkflowInstanceCreatorProvider,
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "CreateDefaultInstance",
    async execute(ctx: RequestContext<WorkflowDesc>): Promise<void> {
      const workflow = ctx.newState;
      const metadata = workflow.metadata;
      if (metadata === undefined) {
        throw internalError(
          new Error("workflow metadata is nil after persist"),
          "workflow metadata is nil after persist",
        );
      }

      logger.info("Creating default instance for workflow", {
        workflowId: metadata.id,
        slug: metadata.slug,
        org: metadata.org,
      });

      const instanceRequest = buildDefaultWorkflowInstanceRequest(metadata);

      // Go create.go:118-121 wraps the downstream error with fmt.Errorf
      // ("failed to create default instance: %w"); the wire keeps the inner
      // CODE but carries the wrapped text, transport formatting included —
      // mirrored via goWrappedStatusError (parent DD-003; the leak is
      // oss#852, a both-editions post-cutover fix). Unstatused failures
      // fall to the pipeline's Internal fallback, exactly Go's plain-error
      // path.
      let created: WorkflowInstance;
      try {
        created = await creatorProvider().createAsSystem(instanceRequest);
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError("failed to create default instance", error);
        }
        throw new Error(
          `failed to create default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      logger.info("Successfully created default instance for workflow", {
        instanceId: created.metadata?.id ?? "",
        workflowId: metadata.id,
      });

      ctx.set(DEFAULT_INSTANCE_ID_KEY, created.metadata?.id ?? "");
    },
  };
}

export function newUpdateWorkflowStatusWithDefaultInstanceStep(
  store: Store,
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "UpdateWorkflowStatusWithDefaultInstance",
    async execute(ctx: RequestContext<WorkflowDesc>): Promise<void> {
      const workflow = ctx.newState;
      const workflowId = workflow.metadata?.id ?? "";

      const defaultInstanceId = ctx.get(DEFAULT_INSTANCE_ID_KEY);
      if (typeof defaultInstanceId !== "string" || defaultInstanceId === "") {
        logger.error("DEFAULT_INSTANCE_ID not found in context for workflow", {
          workflowId,
        });
        throw new Error("default instance ID not found in context");
      }

      workflow.status ??= create(WorkflowStatusSchema);
      workflow.status.defaultInstanceId = defaultInstanceId;

      try {
        await store.saveResource(
          ctx.apiResourceKind,
          workflowId,
          WorkflowSchema,
          workflow,
        );
      } catch (error) {
        logger.error("failed to persist workflow with default_instance_id", {
          error: error instanceof Error ? error.message : String(error),
          workflowId,
        });
        throw new Error(
          `failed to persist workflow with default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      ctx.setNewState(workflow);

      logger.info("updated workflow status with default_instance_id", {
        defaultInstanceId,
        workflowId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// CascadeDeleteInstances — delete_cascade.go: workflow deletion cascades to
// ALL of the workflow's instances — the system-managed default AND
// user-created ones — before the workflow row itself is removed (children
// before parent, so a mid-failure retry converges).
//
// WorkflowInstance slugs are org-scoped and the parent workflow's detail
// page is the only instance-management surface, so an orphan would occupy
// its slug org-wide forever with no UI left to delete it (oss#592, repro'd
// live). Instances are configuration OF the workflow, meaningless without
// it; owner ruling: they go with it (the agent cascade shares this contract
// since oss#611).
//
// What deliberately SURVIVES a workflow delete, and must never be swept
// into this cascade:
//   - WorkflowExecutions — historical record (owner ruling on #582). They
//     carry a denormalized spec.workflow_id and remain viewable after the
//     workflow (and its instances) are gone.
//   - Version/audit rows — surviving executions render their historical
//     graphs via getVersion(workflow_id, version_hash), so deleting version
//     rows would break the execution viewer for exactly the executions the
//     ruling preserves.
//
// Instances are matched by spec.workflow_id — a required, validated field
// on every instance — so a single ID sweep covers the default instance too.
// ---------------------------------------------------------------------------

export function newCascadeDeleteWorkflowInstancesStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteInstances",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const workflow = ctx.get(EXISTING_RESOURCE_KEY) as Workflow | undefined;
      if (workflow === undefined) {
        throw internalError(
          new Error("workflow not found in context (LoadExistingForDelete must run first)"),
          "workflow not found in context (LoadExistingForDelete must run first)",
        );
      }
      const workflowId = workflow.metadata?.id ?? "";

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.workflow_instance);
      } catch (error) {
        throw internalError(error, "failed to list workflow instances for cascade delete");
      }

      let deleted = 0;
      for (const data of rows) {
        let instance: WorkflowInstance;
        try {
          instance = fromBinary(WorkflowInstanceSchema, data);
        } catch {
          continue;
        }
        if (instance.spec?.workflowId !== workflowId) {
          continue;
        }
        const instanceId = instance.metadata?.id ?? "";
        try {
          await store.deleteResource(ApiResourceKind.workflow_instance, instanceId);
        } catch (error) {
          throw internalError(
            error,
            `failed to cascade-delete instance ${instanceId} of workflow ${workflowId}`,
          );
        }

        // Best-effort, matching DeleteSearchIndexStep: a stale index entry
        // is a cosmetic search artifact, not a correctness problem.
        try {
          await store.deleteSearchIndex(ApiResourceKind.workflow_instance, instanceId);
        } catch (error) {
          logger.warn(
            "CascadeDeleteInstances: failed to remove search index entry (best-effort)",
            {
              error: error instanceof Error ? error.message : String(error),
              instanceId,
            },
          );
        }
        deleted++;
      }

      if (deleted > 0) {
        logger.info("cascade-deleted instances of workflow", {
          count: deleted,
          workflowId,
        });
      }
    },
  };
}
