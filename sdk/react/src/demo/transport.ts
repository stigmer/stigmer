import type { FixtureRegistry } from "./types";

/**
 * Minimal shape of a Connect-RPC method descriptor.
 *
 * Matches the relevant fields of `DescMethodUnary` and `DescMethodStreaming`
 * from `@bufbuild/protobuf` without importing the full generic types.
 * The transport only needs the service type name and method name to
 * look up fixture handlers.
 */
interface RpcMethodDescriptor {
  readonly parent: { readonly typeName: string };
  readonly name: string;
}

function fixtureKey(method: RpcMethodDescriptor): string {
  return `${method.parent.typeName}/${method.name}`;
}

function shortServiceName(method: RpcMethodDescriptor): string {
  return method.parent.typeName.split(".").pop() ?? method.parent.typeName;
}

/**
 * A Connect-RPC `Transport` backed by in-memory fixture data.
 *
 * Implements the two-method `Transport` interface (`unary` and `stream`)
 * from `@connectrpc/connect`. When a generated client issues an RPC,
 * the transport looks up the matching fixture handler by
 * `"<service typeName>/<method name>"` and returns its result.
 *
 * Methods without registered fixtures throw a descriptive error
 * identifying the missing key and how to register it.
 *
 * This class is not typed as `implements Transport` because the interface
 * uses complex generics from `@bufbuild/protobuf` that would force a
 * runtime dependency on `@connectrpc/connect` in `@stigmer/react`.
 * The runtime shape is fully compatible — the client factory casts the
 * instance to `Transport` at the single point where it is passed to
 * generated client constructors.
 */
export class DemoTransport {
  private readonly fixtures: FixtureRegistry;

  constructor(fixtures: FixtureRegistry) {
    this.fixtures = fixtures;
  }

  async unary(
    method: RpcMethodDescriptor,
    _signal: AbortSignal | undefined,
    _timeoutMs: number | undefined,
    _header: HeadersInit | undefined,
    input: unknown,
  ) {
    const key = fixtureKey(method);
    const entry = this.fixtures.get(key);

    if (!entry?.unary) {
      throw new Error(
        `No demo fixture for ${shortServiceName(method)}/${method.name}. ` +
          `Add a fixture with key "${key}" to your DemoScenario.`,
      );
    }

    return {
      stream: false as const,
      message: entry.unary(input),
      method,
      service: method.parent,
      header: new Headers(),
      trailer: new Headers(),
    };
  }

  async stream(
    method: RpcMethodDescriptor,
    _signal: AbortSignal | undefined,
    _timeoutMs: number | undefined,
    _header: HeadersInit | undefined,
    input: AsyncIterable<unknown>,
  ) {
    const key = fixtureKey(method);
    const entry = this.fixtures.get(key);

    if (!entry?.stream) {
      throw new Error(
        `No demo fixture for ${shortServiceName(method)}/${method.name}. ` +
          `Add a fixture with key "${key}" to your DemoScenario.`,
      );
    }

    // Server-streaming RPCs send a single request message wrapped in an
    // async iterable by createClient. Extract it for the fixture handler.
    let request: unknown;
    for await (const msg of input) {
      request = msg;
      break;
    }

    return {
      stream: true as const,
      message: toAsyncIterable(entry.stream(request)),
      method,
      service: method.parent,
      header: new Headers(),
      trailer: new Headers(),
    };
  }
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}
