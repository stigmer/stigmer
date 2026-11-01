// The visibility rule every manifest engine follows: the SDK's
// ManifestClient (the console's YAML editors) and the CLI's `apply -f`,
// beside the slug rules (slug.ts) and in the same shape.
//
// An apply keeps the stored visibility on both editions: `updateVisibility`
// is the only door, so the server's guards (the levels a kind supports, the
// caller's right to widen) run on every change. A manifest that declares a
// level other than the stored one is followed with one `updateVisibility`
// after the apply: `followDeclaredVisibility`. A manifest that declares no
// level (the enum's zero, which parsing never fills in) or the stored one
// costs nothing, so a file without `visibility` can never narrow a
// resource. A kind with no door keeps its level, and the outcome says so
// instead of dropping the change in silence; `visibilityKept` is the same
// test, for a preview that tells it before the apply.
//
// A refusal after the spec landed is a typed StigmerError carrying what
// the apply stored, chained to the server's error, so a caller words it
// for its surface and `getErrorReason` still reads the server's reason.
// Pinned by __tests__/manifest-visibility.test.ts.

import { create, type Message } from "@bufbuild/protobuf";
import {
  ApiResourceVisibility,
  ApiResourceVisibilitySchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  UpdateVisibilityInputSchema,
  type UpdateVisibilityInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { StigmerError, wrapError } from "../errors.js";
import { metadataOf } from "./parse.js";
import type { ServiceClientFn } from "./registry.js";

/**
 * What the visibility rule needs of a kind: its name for messages, and its
 * `updateVisibility` where it has one. Every manifest registry handler
 * satisfies it, and so does each kind the CLI applies beside them.
 */
export interface VisibilityRulesHandler {
  /** Human-facing name for messages, e.g. `"Agent"`. */
  readonly displayName: string;
  updateVisibility?(clientFor: ServiceClientFn, input: UpdateVisibilityInput): Promise<Message>;
}

/**
 * The spec landed, and the visibility change that followed it was
 * refused. The resource keeps `visibility`; `applied` is what the apply
 * stored.
 */
export class VisibilityChangeRefusedError extends StigmerError {
  /** The resource as the apply stored it, at its kept level. */
  readonly applied: Message;
  /** The level the manifest declared. */
  readonly declaredVisibility: ApiResourceVisibility;
  /** The level the resource keeps. */
  readonly visibility: ApiResourceVisibility;

  constructor(
    displayName: string,
    applied: Message,
    declaredVisibility: ApiResourceVisibility,
    visibility: ApiResourceVisibility,
    cause: unknown,
  ) {
    const wrapped = wrapError(cause);
    super(
      wrapped.code,
      `${displayName} spec applied, but the visibility change to '${levelName(declaredVisibility)}' ` +
        `was refused: ${wrapped.message}. The visibility stays '${levelName(visibility)}'`,
      wrapped.connectCode,
      { cause },
    );
    this.name = "VisibilityChangeRefusedError";
    this.applied = applied;
    this.declaredVisibility = declaredVisibility;
    this.visibility = visibility;
  }
}

/**
 * `true` when applying `declared` over `stored` would leave a declared
 * level behind: the manifest declares a level, it differs from the stored
 * one, and the kind has no `updateVisibility`.
 *
 * @param declared - The message the manifest declares.
 * @param stored - The resource as the server holds it.
 */
export function visibilityKept(
  handler: VisibilityRulesHandler,
  declared: Message,
  stored: Message,
): boolean {
  return handler.updateVisibility === undefined && visibilityChange(declared, stored) !== undefined;
}

/** What following a manifest's declared visibility did. */
export interface DeclaredVisibilityOutcome {
  /** The resource as it stands: at its new level, or the applied one. */
  readonly message: Message;
  /**
   * `true` when the manifest declares another level and the kind has no
   * `updateVisibility`: the resource keeps its level.
   */
  readonly visibilityKept: boolean;
}

/**
 * Follow an applied manifest's declared visibility with one
 * `updateVisibility`, when the manifest declares a level other than the
 * stored one.
 *
 * @param declared - The message the manifest declared (what was applied).
 * @param applied - What the apply returned.
 * @throws {VisibilityChangeRefusedError} When the change is refused; the
 *   spec has landed.
 */
export async function followDeclaredVisibility(
  clientFor: ServiceClientFn,
  handler: VisibilityRulesHandler,
  declared: Message,
  applied: Message,
): Promise<DeclaredVisibilityOutcome> {
  const change = visibilityChange(declared, applied);
  if (change === undefined) {
    return { message: applied, visibilityKept: false };
  }
  if (handler.updateVisibility === undefined) {
    return { message: applied, visibilityKept: true };
  }
  try {
    const updated = await handler.updateVisibility(
      clientFor,
      create(UpdateVisibilityInputSchema, { resourceId: change.resourceId, visibility: change.to }),
    );
    return { message: updated, visibilityKept: false };
  } catch (err) {
    throw new VisibilityChangeRefusedError(handler.displayName, applied, change.to, change.from, err);
  }
}

/**
 * The level change a manifest asks of a stored resource; `undefined` when
 * it declares no level, the stored one, or the resource has no id.
 */
function visibilityChange(
  declared: Message,
  stored: Message,
): { resourceId: string; from: ApiResourceVisibility; to: ApiResourceVisibility } | undefined {
  const to = metadataOf(declared)?.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified;
  const storedMeta = metadataOf(stored);
  const resourceId = storedMeta?.id ?? "";
  const from = storedMeta?.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified;
  if (to === ApiResourceVisibility.api_resource_visibility_unspecified || resourceId === "" || to === from) {
    return undefined;
  }
  return { resourceId, from, to };
}

/** A level as a manifest writes it, e.g. `visibility_org`. */
function levelName(level: ApiResourceVisibility): string {
  return ApiResourceVisibilitySchema.value[level]?.name ?? String(level);
}
