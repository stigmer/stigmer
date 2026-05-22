/**
 * CallGRPC Temporal activity — executes gRPC RPCs for workflow
 * `call: grpc` tasks using dynamic proto loading.
 *
 * Uses @grpc/proto-loader for proto file loading and @grpc/grpc-js
 * for the actual RPC invocation. No pre-compiled proto stubs needed.
 *
 * Current limitations (carried from Go implementation):
 * - Insecure gRPC only (no TLS)
 * - Proto loaded from local filesystem path
 * - No gRPC metadata/headers support
 *
 * Activity contract:
 *   Name:   "CallGrpc"
 *   Input:  (config: GrpcCallConfig, runtimeEnv: Record<string, unknown>)
 *   Output: Record<string, unknown> (JSON response) or string
 */

import { ApplicationFailure } from "@temporalio/activity";
import type { GrpcCallConfig } from "../workflow-engine/types.js";
import { resolveObjectPlaceholders } from "../workflow-engine/resolve.js";

export async function callGrpcAction(
  config: GrpcCallConfig,
  runtimeEnv: Record<string, unknown>,
): Promise<unknown> {
  const resolved = resolveObjectPlaceholders(config, runtimeEnv) as GrpcCallConfig;

  const host = resolved.service.host || "localhost";
  const port = resolved.service.port || 50051;
  const address = `${host}:${port}`;
  const serviceName = resolved.service.name;
  const methodName = resolved.method;
  const args = resolved.arguments ?? {};

  let protoPath = resolved.proto;
  if (protoPath.startsWith("file://")) {
    protoPath = protoPath.slice(7);
  }

  let grpc: typeof import("@grpc/grpc-js");
  let protoLoader: typeof import("@grpc/proto-loader");
  try {
    grpc = await import("@grpc/grpc-js");
    protoLoader = await import("@grpc/proto-loader");
  } catch (err: unknown) {
    throw ApplicationFailure.nonRetryable(
      `gRPC dependencies not available: ${err instanceof Error ? err.message : String(err)}. ` +
      `Install @grpc/grpc-js and @grpc/proto-loader.`,
      "GRPC_DEPS_MISSING",
    );
  }

  let packageDefinition: Awaited<ReturnType<typeof protoLoader.load>>;
  try {
    packageDefinition = await protoLoader.load(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
  } catch (err: unknown) {
    throw ApplicationFailure.nonRetryable(
      `Failed to load proto file '${protoPath}': ${err instanceof Error ? err.message : String(err)}`,
      "GRPC_PROTO_LOAD_FAILED",
    );
  }

  const grpcObject = grpc.loadPackageDefinition(packageDefinition);

  const serviceConstructor = resolveServiceConstructor(grpcObject, serviceName);
  if (!serviceConstructor) {
    throw ApplicationFailure.nonRetryable(
      `Service '${serviceName}' not found in proto '${protoPath}'`,
      "GRPC_SERVICE_NOT_FOUND",
    );
  }

  const client = new serviceConstructor(
    address,
    grpc.credentials.createInsecure(),
  );

  try {
    return await new Promise<unknown>((resolve, reject) => {
      const method = (client as Record<string, unknown>)[methodName];
      if (typeof method !== "function") {
        reject(ApplicationFailure.nonRetryable(
          `Method '${methodName}' not found on service '${serviceName}'`,
          "GRPC_METHOD_NOT_FOUND",
        ));
        return;
      }

      (method as Function).call(client, args, (err: Error | null, response: unknown) => {
        if (err) {
          reject(ApplicationFailure.nonRetryable(
            `gRPC ${serviceName}/${methodName} failed: ${err.message}`,
            "GRPC_CALL_FAILED",
          ));
          return;
        }
        resolve(response);
      });
    });
  } finally {
    client.close();
  }
}

function resolveServiceConstructor(
  grpcObject: Record<string, unknown>,
  serviceName: string,
): (new (...args: unknown[]) => { close(): void }) | null {
  const parts = serviceName.split(".");
  let current: unknown = grpcObject;

  for (const part of parts) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === "function") {
    return current as new (...args: unknown[]) => { close(): void };
  }

  return null;
}

export function createCallGrpcActivities() {
  return {
    CallGrpc: async (
      config: GrpcCallConfig,
      runtimeEnv: Record<string, unknown>,
    ): Promise<unknown> => {
      return callGrpcAction(config, runtimeEnv);
    },
  };
}
