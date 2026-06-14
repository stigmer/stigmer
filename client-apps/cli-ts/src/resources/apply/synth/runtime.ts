// Runtime inference for SDK project synthesis.
//
// A project's `entry_point` extension determines which language runtime executes
// it — there is no explicit `runtime` field (the proto enum was removed; the
// extension is the single source of truth). Port of the Go CLI's
// `internal/cli/apply/runtime.go`; the extension table is kept in lockstep with
// the backend's `supportedEntryPointExtensions` (project validator).

import { extname } from "node:path";
import { UsageError } from "../../../errors/index.js";

/** Language runtime used to execute an SDK entry point. */
export type Runtime = "go" | "python" | "node";

// Extension → runtime. Keep in sync with the backend project validator and Go's
// extensionToRuntime.
const EXTENSION_TO_RUNTIME: ReadonlyMap<string, Runtime> = new Map([
  [".go", "go"],
  [".py", "python"],
  [".ts", "node"],
  [".js", "node"],
  [".mts", "node"],
  [".mjs", "node"],
]);

/**
 * Infer the runtime from an entry point's file extension. Throws a UsageError
 * listing the supported extensions when the extension is unrecognized.
 */
export function inferRuntime(entryPoint: string): Runtime {
  const ext = extname(entryPoint).toLowerCase();
  const runtime = EXTENSION_TO_RUNTIME.get(ext);
  if (runtime !== undefined) return runtime;

  const supported = [...EXTENSION_TO_RUNTIME.keys()].join(", ");
  throw new UsageError(
    `cannot infer runtime from entry point '${entryPoint}' (extension '${ext}')\n\n` + `Supported extensions: ${supported}`,
  );
}
