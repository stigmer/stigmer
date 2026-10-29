/**
 * RequestContext: the state one request's pipeline steps share.
 *
 * input vs newState: `input` is the original, immutable request; `newState`
 * is an auto-cloned copy the steps mutate. The separation keeps the
 * original request pristine for debugging, logging, and idempotency —
 * steps read from and modify newState, never input.
 *
 * Three mechanics, deliberately:
 *   - The resolved ApiResourceKind is a constructor parameter, not a
 *     hidden context value: the controller reads it from the ConnectRPC
 *     contextValues (apiResourceKindKey, injected by the apiresource
 *     interceptor) once and passes it explicitly — a missing kind is a
 *     compile error, not a zero-value surprise (the composition-root
 *     idiom, guidelines §4).
 *   - The CallerIdentity is a REQUIRED constructor parameter (the same
 *     idiom): position 1 of every
 *     chain stamps it, the controller reads it once (callerIdentityOf),
 *     and every construction site that forgets it is a compile error.
 *     The Authorize step and the audit-actor derivation read it here.
 *   - metadata values are typed per key via the small helpers below rather
 *     than blind casts; the KEY STRINGS are stable names steps share.
 */
import { clone } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../extensions/identity.js";

/**
 * The lifecycle chains' loaded-resource context key. On lifecycle pipelines the request `Desc` is the INPUT
 * message, so `ctx.newState` is the input — the loaded resource rides the
 * metadata map under this key, stamped by each chain's LoadExecutionById
 * step. Hoisted here so the two lifecycle modules and
 * extension gate steps registered into recover-chain slots share ONE
 * definition of the string instead of three copies of a silent contract.
 */
export const LOADED_EXECUTION_KEY = "loadedExecution";

export class RequestContext<Desc extends DescMessage> {
  /** The original, immutable request message. */
  readonly input: MessageShape<Desc>;
  /** The request's message schema (steps clone/compare through it). */
  readonly schema: Desc;
  /** The authenticated caller, produced at chain position 1. */
  readonly callerIdentity: CallerIdentity;
  /**
   * The resource kind of the target service (injected by the apiresource
   * interceptor; unknown when the service carries no
   * api_resource_kind option).
   */
  readonly apiResourceKind: ApiResourceKind;

  private state: MessageShape<Desc>;
  private readonly metadata = new Map<string, unknown>();

  constructor(
    schema: Desc,
    input: MessageShape<Desc>,
    callerIdentity: CallerIdentity,
    apiResourceKind: ApiResourceKind = ApiResourceKind.api_resource_kind_unknown,
  ) {
    this.schema = schema;
    this.input = input;
    this.state = clone(schema, input);
    this.callerIdentity = callerIdentity;
    this.apiResourceKind = apiResourceKind;
  }

  /** The resource being built/modified. */
  get newState(): MessageShape<Desc> {
    return this.state;
  }

  /** Replaces the resource being built. */
  setNewState(state: MessageShape<Desc>): void {
    this.state = state;
  }

  /** Inter-step value by key; undefined when absent. */
  get(key: string): unknown {
    return this.metadata.get(key);
  }

  /** Stores an inter-step value. */
  set(key: string, value: unknown): void {
    this.metadata.set(key, value);
  }
}
