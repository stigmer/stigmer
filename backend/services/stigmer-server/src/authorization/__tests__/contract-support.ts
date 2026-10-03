/**
 * The whole contract as descriptors: every service `@stigmer/protos`
 * exports, whichever edition serves it. Tests that pin a fact about the
 * contract itself (an annotation asks a relation the model defines, an
 * annotation's path names a real field) read it here; a test about what
 * this server serves reads the composed routes instead
 * (extensions/__tests__/composed-support.ts).
 *
 * The walk reads the stubs' built `dist`, loaded through the package's own
 * specifiers. `make test-server` builds them first; a bare `vitest` run in a
 * checkout whose `dist` is stale reads services the contract no longer has.
 */
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { DescService } from "@bufbuild/protobuf";

/** Every service descriptor the stubs package exports, in module-path order. */
export async function everyService(): Promise<ReadonlyArray<DescService>> {
  const require = createRequire(import.meta.url);
  const anchor = "ai/stigmer/iam/v1/enum_pb";
  const resolved = require.resolve(`@stigmer/protos/${anchor}`);
  const dist = resolved.slice(0, resolved.length - `${anchor}.js`.length);
  const modules = readdirSync(path.join(dist, "ai"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("_pb.js"))
    .map((file) => `ai/${file.slice(0, -".js".length).split(path.sep).join("/")}`)
    .sort();
  const services: DescService[] = [];
  for (const specifier of modules) {
    const loaded: Record<string, unknown> = await import(`@stigmer/protos/${specifier}`);
    for (const value of Object.values(loaded)) {
      if (isService(value)) {
        services.push(value);
      }
    }
  }
  return services;
}

function isService(value: unknown): value is DescService {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "service" &&
    "methods" in value
  );
}
