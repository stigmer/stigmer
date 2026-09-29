/**
 * BuildNewState + audit stamping + operator identity — ports
 * steps/defaults.go.
 *
 * BuildNewState (create-state builder, aligned with Cloud's
 * CreateOperationBuildNewStateStepV2): clears the client-provided status
 * (system-managed), assigns metadata.id = {kind-prefix}_{lowercase ULID},
 * stamps spec_audit and status_audit identically with event "created",
 * and defaults metadata.visibility from the kind's proto VisibilityConfig
 * (blueprints → org, everything else → private; an explicit level is
 * never overwritten).
 *
 * A create's id is the server's (metadata.proto `id`: "a generated,
 * prefixed id"), so an id the request carries never survives: it is
 * replaced, not refused, because an exported manifest applied again
 * carries its id and must keep working (stigmer/stigmer#1266). For most
 * kinds a chosen id is cosmetic; for a kind whose id other grants hang
 * off, choosing it is a grant. The one exception is an id a step EARLIER
 * in the chain assigned through `assignServerId` (a direct
 * IdentityAccount's derived id, a Memory's early mint): the step records
 * the exact id it chose under SERVER_ASSIGNED_ID_KEY, and BuildNewState
 * keeps metadata.id only while it still equals that record. A claim is a
 * value, not a flag, so a later step that rewrote the id, or a request
 * that happened to carry the same string before any claim, keeps nothing.
 * A kind that derives its id AFTER this step (Organization's CopySlugToId)
 * needs no claim.
 *
 * SpecAudit/StatusAudit are SLOTS, not steps (stigmer/stigmer#540): every
 * setAuditFieldsForUpdate call site declares which slot it owns —
 * SpecAudit for definition changes (search recency, version "pushed at"),
 * StatusAudit for operational changes (Recents, lifecycle metadata).
 *
 * A write the PLATFORM makes on its own (a schedule's clock, a credential's
 * last-use stamp) takes the narrower `bumpStatusAudit` instead: status-audit
 * updated_at + event only, never an actor, because no caller made it (Go's
 * clock bump, "the same two leaves every cloud runtime patch bumps"). Two
 * flavors, two writers, both wire-visible — keep them distinct.
 *
 * This module is also the one home of how an id is SPELLED. `generateId`
 * mints `{prefix}_{ulid}`; `derivedId` is its sibling for the kinds
 * metadata.proto names as deriving their id from a natural key instead
 * (a direct IdentityAccount from its issuer subject, an IamPolicy from its
 * triple): `{prefix}_` + the top 130 bits of sha256 over the key's
 * canonical text as 26 lowercase Crockford-base32 characters. The two
 * shapes are indistinguishable on the wire, so nothing downstream learns
 * a second grammar, and the primary key becomes the one home of "one row
 * per natural key" without a secondary index or a scan.
 */
import { createHash } from "node:crypto";

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

import type { CallerIdentity } from "../../extensions/identity.js";
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

/**
 * The context key under which a step records the create id it assigned
 * before BuildNewState ran (`assignServerId`); its value is that id.
 */
export const SERVER_ASSIGNED_ID_KEY = "serverAssignedId";

/**
 * Assigns a create's id from a step that runs before BuildNewState and
 * claims it, so BuildNewState keeps it instead of replacing it (module
 * header). Setting and claiming are one call, so the two cannot drift.
 */
export function assignServerId<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
  id: string,
): void {
  const metadata = metadataOf(ctx.newState);
  if (metadata === undefined) {
    throw internalError(
      new Error("resource metadata is nil"),
      "assign server id",
    );
  }
  metadata.id = id;
  ctx.set(SERVER_ASSIGNED_ID_KEY, id);
}

export function newBuildNewStateStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "BuildNewState",
    execute(ctx: RequestContext<Desc>): void {
      const resource = ctx.newState;
      const metadata = metadataOf(resource);
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "build new state",
        );
      }

      // 1. Clear the status field — system-managed, never client-provided.
      if (hasStatusField(ctx.schema)) {
        clearStatusField(ctx.schema, resource);
      }

      // 2. Assign the id, {prefix}_{lowercase ULID}, whatever the request
      // carried; keep only an id an earlier step claimed (module header).
      if (
        metadata.id === "" ||
        metadata.id !== ctx.get(SERVER_ASSIGNED_ID_KEY)
      ) {
        metadata.id = generateId(getIdPrefix(ctx.apiResourceKind));
      }

      // 3. Stamp both audit slots identically with event "created",
      // attributed to the request's caller (O2 ruling Q5).
      if (hasStatusField(ctx.schema)) {
        setAuditFieldsForCreate(ctx.schema, resource, ctx.callerIdentity);
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
 * resource without a status (or audit) field is a no-op. The actor is
 * derived from the REQUEST's caller identity (O2 ruling Q5 — the
 * DD-007 amendment): every call site holds a RequestContext, so audit
 * attribution follows the caller, not a process-global.
 */
export function setAuditFieldsForCreate(
  schema: DescMessage,
  resource: Message,
  identity: CallerIdentity,
): void {
  const now = timestampNow();
  const actor = auditActorFor(identity);
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
  identity: CallerIdentity,
): void {
  const now = timestampNow();
  const actor = auditActorFor(identity);
  const { createdBy, createdAt } = creationAuditOf(schema, resource, slot);
  setAuditSlotReflect(
    schema,
    resource,
    slot,
    updatedAuditInfo(createdBy, createdAt, actor, now),
  );
}

/**
 * Stamps the status-audit slot for a write the platform makes on its own —
 * updated_at + event "updated", nothing else (see the module header for why
 * this is not setAuditFieldsForUpdate). Like that helper it SETS a newly
 * allocated slot rather than assigning into the existing one (#540); the
 * slot's created_by/created_at/updated_by carry over unchanged.
 */
export function bumpStatusAudit(status: { audit?: ApiResourceAudit }): void {
  if (status.audit === undefined) {
    status.audit = create(ApiResourceAuditSchema);
  }
  const prior = status.audit.statusAudit;
  const next =
    prior === undefined
      ? create(ApiResourceAuditInfoSchema)
      : clone(ApiResourceAuditInfoSchema, prior);
  next.updatedAt = timestampNow();
  next.event = "updated";
  status.audit.statusAudit = next;
}

// Operator identity (stigmer/stigmer#400): installed once at boot — before
// any request — and read by the identity chassis when it mints the
// trusted-local CallerIdentity (O2; audit stamping now derives its actor
// from that identity rather than reading this seam directly). The
// module-level seam is Go's, kept deliberately: threading a boot-time
// constant through every step constructor would be machinery without a
// beneficiary. The one-shot guard adds the composition-root idiom's
// loudness: a second install is a wiring bug and throws at boot, not a
// silent overwrite.
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
 * The installed operator identity, read by the verifier-chain chassis to
 * mint the trusted-local CallerIdentity (O2): the single-operator trust
 * domain's one principal. Empty email = unconfigured, the "system"
 * placeholder posture. Audit stamping no longer reads this seam directly —
 * it derives the actor from the request's CallerIdentity (ruling Q5),
 * which for local postures carries exactly these values, so the stamped
 * bytes are unchanged.
 */
export function operatorIdentitySnapshot(): {
  email: string;
  displayName: string;
} {
  return { email: operatorEmail, displayName: operatorName };
}

/**
 * The audit actor derived from a caller identity (O2 ruling Q5 — replaces
 * the retired process-global currentAuditActor). A FRESH message per call
 * (audit stamping shares the returned reference across created_by/
 * updated_by; a singleton would alias unrelated resources' audit state).
 *
 * For local postures the trusted-local identity carries the #400 operator
 * identity, so the derived actor is byte-identical to what the retired
 * seam stamped: configured operator → email-first id with display fields;
 * unconfigured → the "system" placeholder, which the runner deliberately
 * demotes to anonymous (SYSTEM_CREATOR_SENTINEL). Verifier-produced
 * identities (O3's OIDC claims onward) stamp their own email/displayName
 * when present, identityId alone otherwise. A PlatformClient-minted
 * caller also stamps the client it came through (platform_client_id):
 * the account alone cannot say, and the execution-context builder keys
 * the PlatformClient environment layer on this record (#1256). Every
 * other identity stamps it empty, so local-posture bytes are unchanged.
 */
export function auditActorFor(identity: CallerIdentity): ApiResourceAuditActor {
  return create(ApiResourceAuditActorSchema, {
    id: identity.identityId,
    email: identity.email ?? "",
    displayName: identity.displayName ?? "",
    platformClientId: identity.platformClientId ?? "",
  });
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
    createdAt:
      info?.createdAt !== undefined ? { ...info.createdAt } : undefined,
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

/** Crockford base32, lowercased — the alphabet every minted ULID id uses. */
const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const DERIVED_ID_CHARS = 26;
const DERIVED_ID_BITS = BigInt(DERIVED_ID_CHARS * 5);
const SHA256_BITS = 256n;

/**
 * The derived id of a kind whose id is a function of its natural key
 * (metadata.proto `id`): `{prefix}_` + the top 130 bits of
 * sha256(canonicalText) as 26 lowercase Crockford-base32 characters. Pure
 * and total; the CALLER owns what `canonicalText` may be (the domains
 * refuse an empty subject or an ambiguous triple before hashing), and the
 * domains' golden vectors are the wire-adjacent pin — a change here
 * re-addresses every derived row open source ever wrote.
 */
export function derivedId(prefix: string, canonicalText: string): string {
  const digest = createHash("sha256").update(canonicalText, "utf8").digest();
  let bits = 0n;
  for (const byte of digest) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let top = bits >> (SHA256_BITS - DERIVED_ID_BITS);
  let encoded = "";
  for (let i = 0; i < DERIVED_ID_CHARS; i++) {
    encoded = CROCKFORD_ALPHABET[Number(top & 31n)] + encoded;
    top >>= 5n;
  }
  return `${prefix}_${encoded}`;
}
