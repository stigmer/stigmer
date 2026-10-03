/**
 * The single-organization fill — a SERVING-chain interceptor, installed
 * only on a composition that declares one organization
 * (`ServerExtension.orgLimit: 1`, the open-source edition).
 *
 * On such a server an empty `org` has one meaning: the organization the
 * server holds. So a request that names none acts in it, and a person on
 * a laptop never meets the word. The interceptor fills it before
 * protovalidate, whose required-org rules then see the value, and before
 * the handler, whose Authorize step reads the request as it arrives
 * (steps/authorize.ts). It never touches an explicit `org`: authorization
 * judges that as on every server.
 *
 * Which field means "the organization" is read from the contract, one
 * rule per method (`fillPathFor`), memoised on first sight:
 *
 *   1. a top-level `string org` on the input, on every service but the
 *      Organization service's own;
 *   2. otherwise `metadata.org`, when the input carries an
 *      ApiResourceMetadata and its service's `api_resource_kind` is
 *      scoped to an organization (`ORGANIZATION`, or `PARENT`: an
 *      execution's organization is its session's).
 *
 * Never filled: the Organization service (an organization's own
 * `metadata.org` stays empty), the kinds that belong to no organization
 * (`OWNER_ONLY` and `NONE` scope: accounts, API keys, execution contexts,
 * platform, plans, licences), nested messages (a spec reference follows
 * `metadata.org` through NormalizeReferences), and streams (no streaming
 * method takes an organization). The per-method inventory is
 * docs/single-organization.md, which single-organization-inventory.test.ts
 * holds equal to this rule over every method the server serves.
 *
 * Serving only: an in-process call is server code, which always names its
 * organization, and three in-process lanes mean something else by an
 * empty one (the parent's organization, every organization the caller
 * sees, a platform-scoped write).
 *
 * The organization is the holder's, settled once in `start()` before the
 * port binds (boot/single-organization.ts): exactly one organization in
 * the store turns the fill on, any other count leaves it off for the
 * process's life. A request with nothing to fill passes through
 * untouched; one that needs a fill is handed on with a filled clone
 * (`{ ...request, message }`), never a mutation of the caller's message.
 */
import { clone, getOption, hasOption } from "@bufbuild/protobuf";
import type { DescField, DescMethod, DescService } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { Interceptor } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { api_resource_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/rpc_service_options_pb";

import { getKindMeta } from "../apiresource-meta.js";

/** Which field of a method's input names its organization on a one-organization server. */
export type FillPath = "org" | "metadata.org" | undefined;

/** Why a method that takes an organization is not filled, for the inventory. */
export type NotFilledReason =
  | "organization service"
  | "kind belongs to no organization";

export interface FillRule {
  readonly path: FillPath;
  /** Set when the input takes an organization the rule deliberately leaves alone. */
  readonly notFilled?: NotFilledReason;
}

const ORG_FIELD = "org";
const METADATA_FIELD = "metadata";

/** The rule for one method, from the contract alone (see the module header). */
export function fillRuleFor(method: DescMethod): FillRule {
  const kind = serviceKind(method.parent);
  const fields = method.input.fields;
  const topOrg = fields.find(
    (f) =>
      f.name === ORG_FIELD && f.fieldKind === "scalar" && f.oneof === undefined,
  );
  const metadata = fields.find(
    (f) =>
      f.name === METADATA_FIELD &&
      f.fieldKind === "message" &&
      f.message.typeName === ApiResourceMetadataSchema.typeName,
  );
  if (topOrg === undefined && metadata === undefined) {
    return { path: undefined };
  }
  if (kind === ApiResourceKind.organization) {
    return { path: undefined, notFilled: "organization service" };
  }
  if (topOrg !== undefined) {
    return { path: "org" };
  }
  if (kind !== undefined && isOrganizationScoped(kind)) {
    return { path: "metadata.org" };
  }
  return { path: undefined, notFilled: "kind belongs to no organization" };
}

function serviceKind(service: DescService): ApiResourceKind | undefined {
  if (!hasOption(service, api_resource_kind)) {
    return undefined;
  }
  const kind = getOption(service, api_resource_kind);
  return kind === ApiResourceKind.api_resource_kind_unknown ? undefined : kind;
}

function isOrganizationScoped(kind: ApiResourceKind): boolean {
  const scope = getKindMeta(kind).authorization?.scopeType;
  return (
    scope === AuthorizationScopeType.ORGANIZATION ||
    scope === AuthorizationScopeType.PARENT
  );
}

/** The organization a one-organization server fills, as `start()` settled it. */
export interface SingleOrganization {
  /** The organization's id, or undefined when the fill is off (the store did not hold exactly one at boot). */
  current(): string | undefined;
}

/** The writable side, owned by the boot step that settles it once. */
export interface SingleOrganizationHolder extends SingleOrganization {
  settle(org: string | undefined): void;
}

export function newSingleOrganizationHolder(): SingleOrganizationHolder {
  let settled = false;
  let org: string | undefined;
  return {
    current: () => org,
    settle(value) {
      if (settled) {
        throw new Error(
          "the single organization is settled once per process, in start()",
        );
      }
      settled = true;
      org = value === "" ? undefined : value;
    },
  };
}

/** The resolved fill for one method: the string field to set, reached through `metadata` when the path says so. */
interface ResolvedFill {
  readonly field: DescField;
  readonly via: DescField | undefined;
}

function resolveFill(method: DescMethod): ResolvedFill | undefined {
  const path = fillRuleFor(method).path;
  if (path === "org") {
    const field = method.input.fields.find((f) => f.name === ORG_FIELD);
    return field === undefined ? undefined : { field, via: undefined };
  }
  if (path === "metadata.org") {
    const via = method.input.fields.find((f) => f.name === METADATA_FIELD);
    const field = ApiResourceMetadataSchema.fields.find(
      (f) => f.name === ORG_FIELD,
    );
    return via === undefined || field === undefined
      ? undefined
      : { field, via };
  }
  return undefined;
}

/** The message that holds the org field, or undefined when `metadata` is unset (protovalidate refuses that request on its own). */
function holderOf(
  root: ReflectMessage,
  fill: ResolvedFill,
): ReflectMessage | undefined {
  if (fill.via === undefined) {
    return root;
  }
  if (fill.via.fieldKind !== "message" || !root.isSet(fill.via)) {
    return undefined;
  }
  return root.get(fill.via);
}

export function createSingleOrganizationInterceptor(
  organization: SingleOrganization,
): Interceptor {
  const fills = new Map<DescMethod, ResolvedFill | undefined>();
  const fillOf = (method: DescMethod): ResolvedFill | undefined => {
    if (!fills.has(method)) {
      fills.set(method, resolveFill(method));
    }
    return fills.get(method);
  };
  return (next) => (request) => {
    const org = organization.current();
    if (request.stream || org === undefined) {
      return next(request);
    }
    const fill = fillOf(request.method);
    if (fill === undefined) {
      return next(request);
    }
    const current = holderOf(
      reflect(request.method.input, request.message),
      fill,
    );
    if (current === undefined || current.get(fill.field) !== "") {
      return next(request);
    }
    const message = clone(request.method.input, request.message);
    holderOf(reflect(request.method.input, message), fill)?.set(
      fill.field,
      org,
    );
    return next({ ...request, message });
  };
}
