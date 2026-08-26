// Debug utility: decode a binary Agent manifest and print it as JSON.
// Port of the former tools/decode-manifest.go.
//
// Usage: node_modules/.bin/tsx tools/codegen/src/decode-manifest/main.ts <manifest-file>

import * as fs from "node:fs";

import { fromBinary, toJson } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

function main(): void {
  const manifestPath = process.argv[2];
  if (manifestPath === undefined) {
    process.stdout.write("Usage: tsx tools/codegen/src/decode-manifest/main.ts <manifest-file>\n");
    process.exit(1);
  }

  const data = fs.readFileSync(manifestPath);
  const agent = fromBinary(AgentSchema, data);
  process.stdout.write(JSON.stringify(toJson(AgentSchema, agent), null, 2) + "\n");
}

main();
