/**
 * BuildNewState + audit stamping + operator identity — ports
 * steps/defaults.go.
 *
 * BuildNewState (create-state builder, aligned with Cloud's
 * CreateOperationBuildNewStateStepV2): clears the client-provided status
 * (system-managed), mints metadata.id = {kind-prefix}_{lowercase ULID}
 * when unset, stamps spec_audit and status_audit identically with event
 * "created", and defaults metadata.visibility from the kind's proto
 * VisibilityConfig (blueprints → org, everything else → private; an
 * explicit level is never overwritten).
 *
 * SpecAudit/StatusAudit are SLOTS, not steps (stigmer/stigmer#540): every
 * setAuditFieldsForUpdate call site declares which slot it owns —
 * SpecAudit for definition changes (search recency, version "pushed at"),
 * StatusAudit for operational changes (Recents, lifecycle metadata).
 */
import { create, clone } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { ulid } from "ulidx";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditActorSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type {
  ApiResourceAudit,
  ApiResourceAuditActor,
  ApiResourceAuditInfo,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { defaultVisibilityFor, getIdPrefix } from "../apiresource-meta.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import {
  getOrCreateStatusField,
  getStatusField,
  hasStatusField,
  messageFieldByName,
  metadataOf,
} from "./shapes.js";

export function newBuildNewStateStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "BuildNewState",
    execute(ctx: RequestContext<Desc>): void {
      const resource = ctx.newState;
      const metadata = metadataOf(resource);
      if (metadata === undefined) {
        throw internalError(new Error("resource metadata is nil"), "build new state");
      }

      // 1. Clear the status field — system-managed, never client-provided.
      if (hasStatusField(ctx.schema)) {
        clearStatusField(ctx.schema, resource);
      }

      // 2. Mint the id when unset (idempotent): {prefix}_{lowercase ULID}.
      if (metadata.id === "") {
        metadata.id = generateId(getIdPrefix(ctx.apiResourceKind));
      }

      // 3. Stamp both audit slots identically with event "created".
      if (hasStatusField(ctx.schema)) {
        setAuditFieldsForCreate(ctx.schema, resource);
      }

      // 4. Default visibility from the kind's proto config when the client
      // left it unspecified — an explicit level is never overwritten.
      if (
        metadata.visibility ===
        ApiResourceVisibility.api_resource_visibility_unspecified
      ) {
        metadata.visibility = defaultVisibilityFor(ctx.apiResourceKind);
      }
    },
  };
}

/** Clears the resource's status (Go clearStatusFieldReflect). */
export function clearStatusField(schema: DescMessage, msg: Message): void {
  const root = reflect(schema, msg);
  const field = root.fields.find(
    (f) => f.name === "status" && f.fieldKind === "message",
  );
  if (field !== undefined && root.isSet(field)) {
    root.clear(field);
  }
}

/**
 * Go SetAuditFieldsForCreate: both slots identical, event "created". A
 * resource without a status (or audit) field is a no-op.
 */
export function setAuditFieldsForCreate(
  schema: DescMessage,
  resource: Message,
): void {
  const now = timestampNow();
  const actor = currentAuditActor();
  const info = create(ApiResourceAuditInfoSchema, {
    createdBy: actor,
    createdAt: now,
    updatedBy: actor,
    updatedAt: now,
    event: "created",
  });
  setAuditReflect(
    schema,
    resource,
    create(ApiResourceAuditSchema, { specAudit: info, statusAudit: info }),
  );
}

/**
 * Which half of status.audit a targeted mutation writes (#540). There is
 * deliberately no default: every setAuditFieldsForUpdate call site must
 * declare which slot it owns.
 */
export type AuditSlot = "spec_audit" | "status_audit";

/**
 * Go SetAuditFieldsForUpdate: stamps ONE audit slot on a targeted
 * mutation. The named slot keeps its created_by/created_at (falling back
 * to the current actor/time when the slot had no prior audit) and gets a
 * fresh updated_by/updated_at with event "updated"; the other slot is not
 * rewritten. The write SETS a newly allocated slot message — never mutates
 * the existing slot in place (skill push copies slot pointers onto a new
 * wrapper; in-place assignment would corrupt the in-memory original, #540).
 */
export function setAuditFieldsForUpdate(
  schema: DescMessage,
  resource: Message,
  slot: AuditSlot,
): void {
  const now = timestampNow();
  const actor = currentAuditActor();
  const { createdBy, createdAt } = creationAuditOf(schema, resource, slot);
  setAuditSlotReflect(
    schema,
    resource,
    slot,
    updatedAuditInfo(createdBy, createdAt, actor, now),
  );
}

// Operator identity (stigmer/stigmer#400): installed once at boot — before
// any request — and read on every audit stamp. The module-level seam is
// Go's, kept deliberately: threading a boot-time constant through every
// step constructor would be machinery without a beneficiary. The one-shot
// guard adds the composition-root idiom's loudness: a second install is a
// wiring bug and throws at boot, not a silent overwrite.
let operatorEmail = "";
let operatorName = "";
let operatorIdentityInstalled = false;

/**
 * Installs the operator identity (STIGMER_OPERATOR_EMAIL/NAME — validation
 * lives with the config loader). Empty email keeps the "system"
 * placeholder behavior. Call exactly once at boot.
 */
export function setOperatorIdentity(email: string, displayName: string): void {
  if (operatorIdentityInstalled) {
    throw new Error("operator identity already installed (boot wiring bug)");
  }
  operatorIdentityInstalled = true;
  operatorEmail = email;
  operatorName = displayName;
}

/** Test seam: resets the one-shot guard (never called by production code). */
export function resetOperatorIdentityForTests(): void {
  operatorIdentityInstalled = false;
  operatorEmail = "";
  operatorName = "";
}

/**
 * Go currentAuditActor: a FRESH message per call (audit stamping shares
 * the returned reference across created_by/updated_by; a singleton would
 * alias unrelated resources' audit state).
 *
 * With a configured operator, every write this process makes is attributed
 * to that operator — a self-hosted install is a single-operator trust
 * domain. The id deliberately carries the email (no local identity
 * accounts exist to reference; downstream caller-identity resolution is
 * email-first). Unconfigured keeps the "system" placeholder, which the
 * runner deliberately demotes to anonymous (SYSTEM_CREATOR_SENTINEL).
 */
export function currentAuditActor(): ApiResourceAuditActor {
  if (operatorEmail !== "") {
    return create(ApiResourceAuditActorSchema, {
      id: operatorEmail,
      email: operatorEmail,
      displayName: operatorName,
    });
  }
  return create(ApiResourceAuditActorSchema, { id: "system", avatar: "" });
}

/**
 * Go updatedAuditInfo: preserved creation identity (falling back to the
 * updating actor/time when the resource had none) + a fresh update stamp.
 */
export function updatedAuditInfo(
  createdBy: ApiResourceAuditActor | undefined,
  createdAt: Timestamp | undefined,
  actor: ApiResourceAuditActor,
  now: Timestamp,
): ApiResourceAuditInfo {
  return create(ApiResourceAuditInfoSchema, {
    createdBy: createdBy ?? actor,
    createdAt: createdAt ?? now,
    updatedBy: actor,
    updatedAt: now,
    event: "updated",
  });
}

/**
 * Go creationAuditOf: created_by/created_at from the named slot, as deep
 * copies (they must survive the audit field being overwritten). Either may
 * be undefined when absent — callers decide the fallback.
 */
export function creationAuditOf(
  schema: DescMessage,
  resource: Message,
  slot: AuditSlot,
): {
  createdBy: ApiResourceAuditActor | undefined;
  createdAt: Timestamp | undefined;
} {
  const audit = auditOf(schema, resource);
  const info = slot === "spec_audit" ? audit?.specAudit : audit?.statusAudit;
  return {
    createdBy:
      info?.createdBy !== undefined
        ? clone(ApiResourceAuditActorSchema, info.createdBy)
        : undefined,
    createdAt: info?.createdAt !== undefined ? { ...info.createdAt } : undefined,
  };
}

/** The resource's status.audit, undefined at any absent link (read-only). */
export function auditOf(
  schema: DescMessage,
  resource: Message,
): ApiResourceAudit | undefined {
  const status = getStatusField(schema, resource);
  if (status === undefined) {
    return undefined;
  }
  const auditField = messageFieldByName(status, "audit");
  if (auditField === undefined || !status.isSet(auditField)) {
    return undefined;
  }
  return status.get(auditField).message as unknown as ApiResourceAudit;
}

/**
 * Go setAuditReflect: writes the whole audit block onto status.audit,
 * creating status if needed. Kinds without status/audit are a no-op.
 */
export function setAuditReflect(
  schema: DescMessage,
  resource: Message,
  audit: ApiResourceAudit,
): void {
  const status = getOrCreateStatusField(schema, resource);
  if (status === undefined) {
    return;
  }
  const auditField = messageFieldByName(status, "audit");
  if (auditField === undefined) {
    return;
  }
  status.set(auditField, reflect(ApiResourceAuditSchema, audit));
}

/**
 * Go setAuditSlotReflect: writes one slot of status.audit, leaving the
 * other untouched (creating status/audit wrappers as needed).
 */
function setAuditSlotReflect(
  schema: DescMessage,
  resource: Message,
  slot: AuditSlot,
  info: ApiResourceAuditInfo,
): void {
  const status = getOrCreateStatusField(schema, resource);
  if (status === undefined) {
    return;
  }
  const auditField = messageFieldByName(status, "audit");
  if (auditField === undefined) {
    return;
  }
  if (!status.isSet(auditField)) {
    status.set(auditField, reflect(auditField.message));
  }
  const auditMsg: ReflectMessage = status.get(auditField);
  const slotField = messageFieldByName(auditMsg, slot);
  if (slotField === undefined) {
    return;
  }
  auditMsg.set(slotField, reflect(ApiResourceAuditInfoSchema, info));
}

/**
 * Go GenerateID: {prefix}_{lowercase ULID}, e.g.
 * agt_01arz3ndektsv4rrffq69g5fav. ulidx matches oklog/ulid's format
 * (Crockford base32, 48-bit time + 80-bit randomness); lowercased for URL
 * consistency, exactly as Go lowercases oklog's output.
 */
export function generateId(prefix: string): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}
