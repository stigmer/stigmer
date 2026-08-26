// protoc-gen-stigmer-schema — Stage 1 of the codegen pipeline as a buf
// plugin: compiled protos in, the committed JSON schema tree out
// (tools/codegen/schemas, wired via apis/buf.gen.schema.yaml).
//
// This replaces the Go proto2schema tool, which parsed proto SOURCES itself
// and resolved imports out of buf's module cache. As a plugin, buf does the
// compilation and hands ready descriptors (with SourceCodeInfo and all
// extension definitions) on stdin; output files travel back on stdout in a
// CodeGeneratorResponse, so buf owns all filesystem writes — and with
// `clean: true` in the template, stale-schema removal too.
//
// The plugin speaks the raw protoc plugin contract via @bufbuild/protobuf's
// well-known types rather than @bufbuild/protoplugin: that framework is
// built for ECMAScript code generation (transpilation, import management),
// none of which applies to emitting Go-json-shaped JSON files.

import * as process from "node:process";

import { create, createFileRegistry, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  CodeGeneratorRequestSchema,
  CodeGeneratorResponse_Feature,
  CodeGeneratorResponseSchema,
  FileDescriptorSetSchema,
} from "@bufbuild/protobuf/wkt";
import type { DescFile } from "@bufbuild/protobuf";

import { CommentIndex } from "./comments.js";
import { generateSchemas } from "./generate.js";
import { OptionsReader } from "./options.js";

// stdin arrives as a pipe that may be non-blocking, where a synchronous
// fs.readFileSync(0) intermittently fails with EAGAIN — stream it instead.
async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const request = fromBinary(CodeGeneratorRequestSchema, await readStdin());

  const set = create(FileDescriptorSetSchema, { file: request.protoFile });
  const registry = createFileRegistry(set);

  const moduleFiles: DescFile[] = [];
  for (const name of request.fileToGenerate) {
    const file = registry.getFile(name);
    if (file === undefined) {
      throw new Error(`file to generate not found in request: ${name}`);
    }
    moduleFiles.push(file);
  }

  const files = generateSchemas(moduleFiles, {
    comments: new CommentIndex(),
    options: new OptionsReader(registry),
  });

  const response = create(CodeGeneratorResponseSchema, {
    supportedFeatures: BigInt(CodeGeneratorResponse_Feature.PROTO3_OPTIONAL),
    file: files.map((f) => ({ name: f.name, content: f.content })),
  });
  process.stdout.write(toBinary(CodeGeneratorResponseSchema, response));
  process.stderr.write(`protoc-gen-stigmer-schema: emitted ${files.length} schema files\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`protoc-gen-stigmer-schema: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
