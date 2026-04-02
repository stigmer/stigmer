/**
 * Handler for a unary (request-response) RPC fixture.
 *
 * Receives the protobuf request message and returns the response message.
 * Build responses with `create()` from `@bufbuild/protobuf` to ensure
 * correct message shapes.
 */
export type UnaryFixtureHandler = (request: unknown) => unknown;

/**
 * Handler for a server-streaming RPC fixture.
 *
 * Receives the protobuf request message and returns an array of response
 * messages that the transport yields as an async stream.
 */
export type StreamFixtureHandler = (request: unknown) => unknown[];

/**
 * Fixture configuration for a single RPC method.
 *
 * Register `unary` for request-response RPCs, or `stream` for
 * server-streaming RPCs. The transport checks the appropriate handler
 * based on how the generated client invokes the method.
 */
export interface FixtureEntry {
  readonly unary?: UnaryFixtureHandler;
  readonly stream?: StreamFixtureHandler;
}

/**
 * Map of fully-qualified RPC method keys to fixture handlers.
 *
 * Keys use the format `"<proto service typeName>/<method name>"`, e.g.:
 * ```
 * "ai.stigmer.agentic.session.v1.SessionQueryController/get"
 * ```
 *
 * Use {@link rpcKey} to construct keys from proto service descriptors.
 */
export type FixtureRegistry = ReadonlyMap<string, FixtureEntry>;

/**
 * A collection of RPC fixture handlers that powers a demo client.
 *
 * Pass to {@link createDemoClient} to obtain a `Stigmer`-compatible
 * client that resolves RPCs from in-memory data instead of a live backend.
 */
export interface DemoScenario {
  readonly fixtures: FixtureRegistry;
}

/**
 * Construct a fixture registry key from a proto service descriptor
 * and method name.
 *
 * @example
 * ```ts
 * import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
 *
 * rpcKey(SessionQueryController, "get")
 * // → "ai.stigmer.agentic.session.v1.SessionQueryController/get"
 * ```
 */
export function rpcKey(
  service: { readonly typeName: string },
  method: string,
): string {
  return `${service.typeName}/${method}`;
}
