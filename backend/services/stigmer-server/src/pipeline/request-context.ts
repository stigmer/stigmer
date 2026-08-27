/**
 * RequestContext — ports backend/libs/go/grpc/request/pipeline/context.go.
 *
 * input vs newState: `input` is the original, immutable request; `newState`
 * is an auto-cloned copy the steps mutate. The separation keeps the
 * original request pristine for debugging, logging, and idempotency —
 * steps read from and modify newState, never input.
 *
 * Three mechanics differ from Go, deliberately:
 *   - The resolved ApiResourceKind is a constructor parameter instead of a
 *     hidden context.Context value. Go's steps fish it out of ctx (injected
 *     by the apiresource interceptor); here the controller reads it from
 *     the ConnectRPC contextValues (apiResourceKindKey) once and passes it
 *     explicitly — a missing kind is a compile error, not a zero-value
 *     surprise (the composition-root idiom, guidelines §4).
 *   - The CallerIdentity is a REQUIRED constructor parameter (O2, ruling
 *     Q3 — the same doctrine delivered for real): position 1 of every
 *     chain stamps it, the controller reads it once (callerIdentityOf),
 *     and every construction site that forgets it is a compile error.
 *     The Authorize step and the audit-actor derivation read it here.
 *   - metadata values are typed per key via the small helpers below rather
 *     than blind interface{} casts; the KEY STRINGS stay identical to Go's
 *     so the inventory's step notes read straight onto this code.
 */
import { clone } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../extensions/identity.js";

export class RequestContext<Desc extends DescMessage> {
  /** The original, immutable request message. */
  readonly input: MessageShape<Desc>;
  /** The request's message schema (steps clone/compare through it). */
  readonly schema: Desc;
  /** The authenticated caller, produced at chain position 1 (O2). */
  readonly callerIdentity: CallerIdentity;
  /**
   * The resource kind of the target service (Go: injected by the
   * apiresource interceptor; unknown when the service carries no
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

  /** The resource being built/modified (Go NewState()). */
  get newState(): MessageShape<Desc> {
    return this.state;
  }

  /** Replaces the resource being built (Go SetNewState()). */
  setNewState(state: MessageShape<Desc>): void {
    this.state = state;
  }

  /** Inter-step value by key; undefined when absent (Go Get()). */
  get(key: string): unknown {
    return this.metadata.get(key);
  }

  /** Stores an inter-step value (Go Set()). */
  set(key: string, value: unknown): void {
    this.metadata.set(key, value);
  }
}
