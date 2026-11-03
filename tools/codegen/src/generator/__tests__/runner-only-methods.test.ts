// Pins the runner-only mark against the whole contract and the committed
// service schemas every SDK client and reference page is generated from.
// A method carrying `ai.stigmer.commons.rpc.is_runner_only` is one only a
// run's runner calls, so:
//   - no committed services/*.json lists it, which keeps it out of the
//     TypeScript, Go, Python and Java clients and the SDK reference pages
//     (a stale schema regenerated without the extractor's filter fails here);
//   - it also carries is_skip_authorization: a person's permission cannot
//     tell a runner from the person it acts for, so a runner-only method that
//     ran one would contradict its own mark.
// The mark's set is read from the descriptors, never listed here, so a
// method marked later is held to both rules without editing this file. The
// scan is every file the stubs package defines
// (src/__test-utils__/stub-descriptors.ts); it is pinned to find the File's
// RunFileController.mount, so an empty scan cannot pass.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { getExtension, hasExtension, type DescMethod } from "@bufbuild/protobuf";
import { is_runner_only, is_skip_authorization } from "@stigmer/apis/ai/stigmer/commons/rpc/method_options_pb";
import { beforeAll, describe, expect, it } from "vitest";

import { stubFiles } from "../../__test-utils__/stub-descriptors.js";

const SERVICES_DIR = path.resolve(import.meta.dirname, "../../../schemas/services");

interface CommittedServiceSchema {
  package: string;
  services: { name: string; methods: { name: string }[] }[];
}

function flag(method: DescMethod, ext: typeof is_runner_only): boolean {
  const options = method.proto.options;
  return options !== undefined && hasExtension(options, ext) && getExtension(options, ext);
}

/** Every method the stubs mark runner-only. */
async function runnerOnlyMethods(): Promise<DescMethod[]> {
  const out: DescMethod[] = [];
  for (const file of (await stubFiles()).values()) {
    for (const svc of file.services) {
      for (const method of svc.methods) {
        if (flag(method, is_runner_only)) out.push(method);
      }
    }
  }
  return out;
}

const qualified = (method: DescMethod): string => `${method.parent.typeName}.${method.name}`;

/** `<package>.<Service>.<rpc>` of every method a committed service schema lists, rpc names lower-camel as in the proto. */
function committedMethods(): Set<string> {
  const out = new Set<string>();
  for (const entry of readdirSync(SERVICES_DIR)) {
    if (!entry.endsWith(".json")) continue;
    const schema = JSON.parse(readFileSync(path.join(SERVICES_DIR, entry), "utf8")) as CommittedServiceSchema;
    for (const svc of schema.services ?? []) {
      for (const m of svc.methods) {
        out.add(`${schema.package}.${svc.name}.${m.name.slice(0, 1).toLowerCase()}${m.name.slice(1)}`);
      }
    }
  }
  return out;
}

// The scan imports every stub module cold, which under coverage and a loaded
// machine has taken over vitest's 5 s per-case default; it runs once, here.
const SCAN_TIMEOUT_MS = 60_000;

describe("runner-only methods", () => {
  let runnerOnly: DescMethod[] = [];
  beforeAll(async () => {
    runnerOnly = await runnerOnlyMethods();
  }, SCAN_TIMEOUT_MS);

  it("are listed by no committed service schema, so no SDK offers one", () => {
    const marked = runnerOnly.map(qualified);
    expect(marked).toContain("ai.stigmer.agentic.file.v1.RunFileController.mount");

    const committed = committedMethods();
    expect(committed).toContain("ai.stigmer.agentic.file.v1.FileQueryController.get");
    expect(marked.filter((name) => committed.has(name))).toEqual([]);
  });

  it("each also skip authorization, since a person's permission cannot admit a runner", () => {
    const unskipped = runnerOnly.filter((method) => !flag(method, is_skip_authorization)).map(qualified);
    expect(unskipped).toEqual([]);
  });
});
