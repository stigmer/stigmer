/**
 * `listAccessHistory`: an organization's access history, read back from
 * the history its grant store keeps (store.ts `listChanges`). The reader
 * is the writer's other half: the edition that opens the writer
 * (boot/compose.ts, every edition above open source) serves the read, so
 * one declaration decides both. Open source keeps no history and refuses
 * the read UNIMPLEMENTED with the house sentence.
 *
 * Chain: Authorize (can_view_access_history on the organization, by the
 * annotation) → ValidateProto → the open-source refusal →
 * [grant-list-access-history:pre-read] → the read. The refusal comes
 * after Authorize, as the tuple-half queries' does (controller.ts
 * `requireQueryEngine`), so a caller learns the edition only once allowed
 * to ask. The slot is where a host refuses a read its own rules forbid
 * (the Cloud, an organization whose plan lacks the history).
 *
 * Reading. Without `after_sequence` the entries come newest first; with it
 * oldest first, strictly after that number, the read a tool that keeps its
 * own copy resumes with. A page holds `page_size` entries, read by the one
 * page rule (`listPageSizeOf`: 0 is 50, above 100 reads as 100; a history
 * only grows, so no size means "all"). The store is asked for one more than
 * the page, so the token is set only when more entries
 * exist; a follow read that reaches the newest entry ends without one, and
 * the tool next asks after the last number it holds. The token is opaque
 * and versioned: the last number returned and a hash of the request's
 * other fields (the direction among them), refused as `invalid page_token` when malformed
 * and as issued for another request when they differ, as on every paged
 * lane (pipeline/steps/list-page.ts).
 *
 * Who reads what. The annotation admits the organization's owners and
 * admins and a parent's admins. A parent's admins manage a child and read
 * none of its resources (fga/model/README.md), so for a caller without
 * `can_view` on the organization the read keeps only the entries about the
 * organization itself: its memberships and roles, never a resource inside
 * it or who was given access to one. Such a page may be short, even empty,
 * and still carry a token; the numbers it shows have gaps where the left
 * out entries are.
 *
 * Retention. Every page says how long the history is kept and the oldest
 * number the organization still holds (`retention_days`,
 * `oldest_sequence`), so a tool that asked after N can tell entries
 * retention removed from entries left out for its caller. The window is
 * the composition's declaration (`ServerExtension.accessHistoryRetentionDays`,
 * 0 when none). The oldest number is the store's own first entry
 * (`listChanges` after 0, one primary-key read), read after the page: two
 * reads with no snapshot between them, so a retention pass between them
 * could have removed entries the page just returned, and the answer is the
 * smaller of the read and the page's lowest examined number. A page never
 * reports an entry it returned as removed. An organization whose every
 * entry was removed holds none, so the page answers one past the last
 * number its history handed out (`lastChangeSequence`, which retention
 * never lowers): a tool that held 42 of 100 still learns 43 to 100 are
 * gone. Only an organization that never recorded an entry reads 0. The
 * last number is read before the oldest entry, so a change that commits
 * between the two reads is numbered past it and never reported removed.
 *
 * Naming happens at read time, never from the stored row's audit stamp: the
 * actor and the principal through the account resolver and the composed
 * principal display, as the access list names them (access-lists.ts), an
 * unknown account keeping its id; the role as the access list renders it,
 * a structural relation keeping its code; the resource as a reference
 * whose slug the reference fill sets to its current name, or leaves empty
 * once it is deleted (pipeline/interceptors/resource-references.ts): within
 * the change's organization, and an organization itself with no `org`, the
 * scope the name table files organizations under (domain/organization/
 * names.ts `organizationNameKey`). The
 * stored bytes never reach the wire.
 *
 * The cause enum is the wire twin of change.ts's union: `CAUSE_ON_WIRE` is
 * a record over that union, so a cause cannot be added that the reader
 * cannot name, and __tests__/access-history.test.ts holds the enum to the
 * record the other way. A cause this binary does not know (written by a
 * later one) reads as unspecified.
 */
import { createHash } from "node:crypto";

import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type {
  AccessHistoryEntry,
  AccessHistoryPage,
  ApiResourceRefView,
  ListAccessHistoryInput,
  RoleInfo,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/io_pb";
import {
  AccessChange,
  AccessChangeCause,
  AccessHistoryEntrySchema,
  AccessHistoryPageSchema,
  ApiResourceRefViewSchema,
  ListAccessHistoryInputSchema,
  RoleInfoSchema,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/io_pb";
import { GrantQueryController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PrincipalDisplay } from "../../extensions/principal-display.js";
import type { Logger } from "../../boot/logger.js";
import { kindByEnumName, kindEnumName } from "../../pipeline/apiresource-meta.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { listPageFingerprint, listPageSizeOf } from "../../pipeline/steps/list-page.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { resolvePrincipalViews } from "./access-lists.js";
import type { PrincipalDisplayResolver } from "./access-lists.js";
import type { GrantChange, GrantChangeCause, GrantChangePage } from "./change.js";
import { ACCESS_HISTORY_UNIMPLEMENTED_MESSAGE } from "./constants.js";
import { roleInfoFromRelation } from "./roles.js";
import type { GrantStore } from "./store.js";

/**
 * Every stored cause and its wire value. A record over the union, so a
 * cause added to change.ts fails to compile here until the reader can name
 * it.
 */
export const CAUSE_ON_WIRE: Readonly<Record<GrantChangeCause, AccessChangeCause>> = {
  grant: AccessChangeCause.grant,
  revoke: AccessChangeCause.revoke,
  structural: AccessChangeCause.structural,
  organization_access_revoked: AccessChangeCause.organization_access_revoked,
  left_organization: AccessChangeCause.left_organization,
  resource_deleted: AccessChangeCause.resource_deleted,
  organization_created: AccessChangeCause.organization_created,
  first_sign_in: AccessChangeCause.first_sign_in,
  role_reconciliation: AccessChangeCause.role_reconciliation,
  operator_ownership: AccessChangeCause.operator_ownership,
  platform_client_grant: AccessChangeCause.platform_client_grant,
  service_account_created: AccessChangeCause.service_account_created,
};

/** What the read needs from the controller's deps. */
export interface AccessHistoryDeps {
  readonly grants: GrantStore;
  readonly authorizer: Authorizer;
  readonly principalDisplay: PrincipalDisplay | undefined;
  readonly gateSteps: ResolvedGateSteps;
  readonly edition: ServerEdition;
  /** The declared access-history window in days; undefined keeps every entry. */
  readonly retentionDays: number | undefined;
  readonly logger: Logger;
}

/** The handler: the chain, then the read. */
export async function listAccessHistory(
  deps: AccessHistoryDeps,
  displayResolver: PrincipalDisplayResolver,
  input: ListAccessHistoryInput,
  ctx: HandlerContext,
): Promise<AccessHistoryPage> {
  const reqCtx = new RequestContext(
    ListAccessHistoryInputSchema,
    input,
    callerIdentityOf(ctx),
    ctx.values.get(apiResourceKindKey),
  );
  const pipeline = newPipeline<typeof ListAccessHistoryInputSchema>(
    "grant-listAccessHistory",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        GrantQueryController.method.listAccessHistory,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newRefuseWithoutHistoryStep(deps.edition));
  for (const step of stepsForSlot<typeof ListAccessHistoryInputSchema>(
    deps.gateSteps,
    "grant-list-access-history:pre-read",
  )) {
    pipeline.addStep(step);
  }
  await pipeline.build().execute(reqCtx);
  const insider = await readsWholeOrganization(deps.authorizer, reqCtx.callerIdentity, input.org);
  return readAccessHistory(deps, displayResolver, input, insider);
}

/**
 * Whether the caller may read every entry: one who can see what the
 * organization holds (`can_view` on it, its own viewers and up). A parent
 * organization's admins read a child's history through `parent_admin`
 * without that: they manage the child and read none of its resources, so
 * they read only the entries about the child organization itself (who
 * holds which role in it), never the names of the resources inside it or
 * who was given access to them.
 */
async function readsWholeOrganization(
  authorizer: Authorizer,
  caller: CallerIdentity,
  org: string,
): Promise<boolean> {
  const decision = await authorizer.authorize(caller, {
    permission: IamPermission.can_view,
    resourceKind: ApiResourceKind.organization,
    resourceId: org,
  });
  if (decision.kind === "unavailable") {
    throw internalError(decision.cause, "failed to authorize the access history");
  }
  return decision.kind === "allow";
}

/** Open source keeps no history, so it has none to serve. */
function newRefuseWithoutHistoryStep(
  edition: ServerEdition,
): PipelineStep<typeof ListAccessHistoryInputSchema> {
  return {
    name: "RefuseWithoutHistory",
    execute(): void {
      if (edition === ServerEdition.oss) {
        throw new ConnectError(ACCESS_HISTORY_UNIMPLEMENTED_MESSAGE, Code.Unimplemented);
      }
    },
  };
}

/** One page of the organization's history, named for people. */
async function readAccessHistory(
  deps: AccessHistoryDeps,
  displayResolver: PrincipalDisplayResolver,
  input: ListAccessHistoryInput,
  insider: boolean,
): Promise<AccessHistoryPage> {
  const ascending = input.afterSequence !== undefined;
  const fingerprint = listPageFingerprint({
    org: input.org,
    after: input.afterSequence ?? null,
  });
  const resumed =
    input.pageToken === ""
      ? undefined
      : decodeAccessHistoryToken(input.pageToken, fingerprint);
  const size = listPageSizeOf(input);
  const page: GrantChangePage = ascending
    ? { limit: size + 1, after: resumed ?? input.afterSequence ?? 0n }
    : resumed === undefined
      ? { limit: size + 1 }
      : { limit: size + 1, before: resumed };

  let changes: ReadonlyArray<GrantChange>;
  try {
    changes = await deps.grants.listChanges(input.org, page);
  } catch (error) {
    throw internalError(error, "failed to read the access history");
  }
  const more = changes.length > size;
  const examined = more ? changes.slice(0, size) : changes;
  // The token continues after the last entry examined, so an entry left
  // out for this caller is never read twice and the page may come back
  // short, even empty, with a token.
  const kept = insider
    ? examined
    : examined.filter((change) => aboutOrganization(change, input.org));
  const entries = await nameEntries(deps, displayResolver, kept);
  const last = examined.at(-1);
  const lowestExamined = ascending ? examined.at(0) : last;
  return create(AccessHistoryPageSchema, {
    entries,
    nextPageToken:
      more && last !== undefined
        ? encodeAccessHistoryToken(last.sequence, fingerprint)
        : "",
    oldestSequence: await oldestKeptSequence(deps, input.org, lowestExamined?.sequence),
    retentionDays: deps.retentionDays ?? 0,
  });
}

/**
 * The lowest number the organization still holds, never above the lowest
 * the page examined: read after the page, a retention pass may have
 * removed entries in between that the page returned. When it holds none,
 * one past the last number it handed out, or 0 when it never recorded one.
 */
async function oldestKeptSequence(
  deps: AccessHistoryDeps,
  org: string,
  lowestExamined: bigint | undefined,
): Promise<bigint> {
  let held: bigint | undefined;
  let last: bigint;
  try {
    // The head first: whatever commits after it is numbered above it.
    last = await deps.grants.lastChangeSequence(org);
    held = (await deps.grants.listChanges(org, { limit: 1, after: 0n })).at(0)?.sequence;
  } catch (error) {
    throw internalError(error, "failed to read the access history");
  }
  if (lowestExamined !== undefined && (held === undefined || lowestExamined < held)) {
    return lowestExamined;
  }
  if (held !== undefined) {
    return held;
  }
  return last === 0n ? 0n : last + 1n;
}

/** Whether a change is about the organization itself rather than a resource in it. */
function aboutOrganization(change: GrantChange, org: string): boolean {
  const resource = change.grant.spec?.resource;
  return resource?.kind === kindEnumName(ApiResourceKind.organization) && resource.id === org;
}

/** The wire entries for a page of changes, every person and grantee named in one pass. */
async function nameEntries(
  deps: AccessHistoryDeps,
  displayResolver: PrincipalDisplayResolver,
  changes: ReadonlyArray<GrantChange>,
): Promise<AccessHistoryEntry[]> {
  let principals: ReadonlyMap<string, ApiResourceRefView>;
  let actors: ReadonlyMap<string, ApiResourceRefView>;
  try {
    principals = await resolvePrincipalViews(
      changes.map((change) => change.grant),
      displayResolver,
      deps.principalDisplay,
    );
    actors = await displayResolver.resolveIdentityAccounts([
      ...new Set(changes.map((change) => change.actor.id).filter((id) => id !== "")),
    ]);
  } catch (error) {
    throw internalError(error, "failed to name the access history");
  }

  return changes.map((change) => {
    const spec = change.grant.spec;
    const principal = spec?.principal;
    const resource = spec?.resource;
    const resourceKind = kindByEnumName(resource?.kind ?? "");
    const principalView =
      principal === undefined
        ? create(ApiResourceRefViewSchema)
        : (principals.get(`${principal.kind}:${principal.id}`) ??
          create(ApiResourceRefViewSchema, {
            kind: principal.kind,
            id: principal.id,
            name: principal.id,
          }));
    const actorView =
      actors.get(change.actor.id) ??
      create(ApiResourceRefViewSchema, { id: change.actor.id });
    return create(AccessHistoryEntrySchema, {
      sequence: change.sequence,
      occurredAt: timestampFromDate(new Date(change.occurredAt)),
      change: change.change === "granted" ? AccessChange.granted : AccessChange.revoked,
      cause: causeOnWire(change.cause),
      actor: actorView,
      actorClass: change.actor.callerClass,
      principal: withRelation(principalView, principal?.relation ?? ""),
      role: roleOf(spec?.relation ?? "", resourceKind),
      resource: create(ApiResourceReferenceSchema, {
        // An organization is named at the platform's scope, so its own
        // reference names no organization; every other resource is named
        // within the organization the change was recorded in.
        org: resourceKind === ApiResourceKind.organization ? "" : change.organizationId,
        kind: resourceKind,
        id: resource?.id ?? "",
      }),
    });
  });
}

/** A resolved view is shared by every entry naming the grantee, so each stamps its own copy. */
function withRelation(view: ApiResourceRefView, relation: string): ApiResourceRefView {
  const stamped = clone(ApiResourceRefViewSchema, view);
  stamped.relation = relation;
  return stamped;
}

/** The role as the access list renders it; a relation that is no role keeps its code. */
function roleOf(relation: string, kind: ApiResourceKind): RoleInfo {
  const role = roleInfoFromRelation(relation, kind);
  if (role.code !== "" || relation === "") {
    return role;
  }
  return create(RoleInfoSchema, { id: relation, code: relation });
}

/** A stored cause's wire value; one this binary does not know reads as unspecified. */
export function causeOnWire(cause: string): AccessChangeCause {
  return Object.hasOwn(CAUSE_ON_WIRE, cause)
    ? CAUSE_ON_WIRE[cause as GrantChangeCause]
    : AccessChangeCause.access_change_cause_unspecified;
}

const TOKEN_VERSION = 1;

/** The largest sequence a token may carry: the store's 64-bit signed integer. */
const MAX_SEQUENCE = BigInt("9223372036854775807");

function fingerprintHash(fingerprint: string): string {
  return createHash("sha256").update(fingerprint).digest("base64url").slice(0, 16);
}

/**
 * An opaque, versioned token for the position after `sequence`. The read's
 * direction is the request's own (`after_sequence` set or not), which the
 * fingerprint binds, so the token need not carry it.
 */
export function encodeAccessHistoryToken(sequence: bigint, fingerprint: string): string {
  const body = {
    v: TOKEN_VERSION,
    s: sequence.toString(),
    f: fingerprintHash(fingerprint),
  };
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/** The sequence a token resumes from, refused as on every paged lane when it is not this request's. */
export function decodeAccessHistoryToken(token: string, fingerprint: string): bigint {
  let body: unknown;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) {
      throw new Error("not canonical base64url");
    }
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalidArgumentError("invalid page_token");
  }
  const parsed = body as { v?: unknown; s?: unknown; f?: unknown } | null;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    parsed.v !== TOKEN_VERSION ||
    typeof parsed.s !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(parsed.s) ||
    BigInt(parsed.s) > MAX_SEQUENCE ||
    typeof parsed.f !== "string"
  ) {
    throw invalidArgumentError("invalid page_token");
  }
  if (parsed.f !== fingerprintHash(fingerprint)) {
    throw invalidArgumentError("page_token was issued for a different request");
  }
  return BigInt(parsed.s);
}
