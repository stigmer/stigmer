/**
 * Pins that the schema extractor leaves every runner-only method out of the
 * service schemas, so no SDK client or reference page offers a call only a
 * run's runner can make. A method is runner-only when it carries
 * `ai.stigmer.commons.rpc.is_runner_only`; the extractor reads it through
 * the request's own registry, as the plugin does, over real descriptors
 * from @stigmer/apis.
 *
 * What is pinned: a whole runner-only service (the File's RunFileController,
 * the vault's VaultValueController, the Eval's RunEvalCaseController) drops
 * out with the types only its methods used; a runner-only method inside a
 * person's service (the session's appendEvents and claimInput) drops out
 * while its service stays; every kept service keeps the role it had while
 * the runner-only services were still listed, since roles become field names
 * on every generated client; and a type a person's method also answers stays.
 */
import { create, createFileRegistry, type DescFile, type FileRegistry } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema, type FileDescriptorProto } from "@bufbuild/protobuf/wkt";
import { file_ai_stigmer_agentic_eval_v1_command } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/command_pb";
import { file_ai_stigmer_agentic_eval_v1_query } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/query_pb";
import { file_ai_stigmer_agentic_eval_v1_run_eval_case } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";
import { file_ai_stigmer_agentic_file_v1_command } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { file_ai_stigmer_agentic_file_v1_query } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { file_ai_stigmer_agentic_file_v1_run_files } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { file_ai_stigmer_agentic_session_v1_command } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { file_ai_stigmer_agentic_session_v1_query } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { file_ai_stigmer_agentic_vault_v1_command } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { file_ai_stigmer_agentic_vault_v1_connect_link } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { file_ai_stigmer_agentic_vault_v1_query } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { file_ai_stigmer_agentic_vault_v1_values } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import { describe, expect, it } from "vitest";

import { CommentIndex } from "../comments.js";
import { OptionsReader } from "../options.js";
import { extractServiceSchemas, type ServiceSchema } from "../services.js";

/** Every file `roots` reaches, dependencies first, as a descriptor set's files. */
function closure(
  files: readonly DescFile[],
  seen = new Map<string, FileDescriptorProto>(),
): Map<string, FileDescriptorProto> {
  for (const file of files) {
    closure(file.dependencies, seen);
    if (!seen.has(file.name)) seen.set(file.name, file.proto);
  }
  return seen;
}

/** A registry over `roots` and what they import, built as the plugin builds its own. */
function registryOf(roots: readonly DescFile[]): FileRegistry {
  return createFileRegistry(create(FileDescriptorSetSchema, { file: [...closure(roots).values()] }));
}

/** One package's service schema, extracted from the registry's copies of `roots`. */
function extract(roots: readonly DescFile[]): ServiceSchema {
  const registry = registryOf(roots);
  const group = roots.map((root) => {
    const file = registry.getFile(root.proto.name);
    if (file === undefined) throw new Error(`${root.proto.name} is not in the registry`);
    return file;
  });
  const schema = extractServiceSchemas(group, {
    comments: new CommentIndex(),
    options: new OptionsReader(registry),
  });
  if (schema === null) throw new Error("no service schema extracted");
  return schema;
}

const roles = (schema: ServiceSchema): Record<string, string> =>
  Object.fromEntries(schema.services.map((svc) => [svc.name, svc.role]));

const methodsOf = (schema: ServiceSchema, service: string): string[] =>
  schema.services.find((svc) => svc.name === service)?.methods.map((m) => m.name) ?? [];

const typeNames = (schema: ServiceSchema): string[] => schema.methodTypes.map((t) => t.name);

describe("OptionsReader.isRunnerOnly", () => {
  it("reads the mark from the registry, true only on a marked method", () => {
    const roots = [file_ai_stigmer_agentic_file_v1_run_files, file_ai_stigmer_agentic_file_v1_command];
    const registry = registryOf(roots);
    const reader = new OptionsReader(registry);
    const methods = roots.flatMap((root) => registry.getFile(root.proto.name)?.services ?? []).flatMap((svc) => svc.methods);

    expect(methods.filter((m) => reader.isRunnerOnly(m)).map((m) => `${m.parent.name}.${m.name}`)).toEqual([
      "RunFileController.mount",
      "RunFileController.createOutputUploads",
      "RunFileController.registerOutputs",
    ]);
  });
});

describe("the service schemas leave runner-only methods out", () => {
  it("drops the File's RunFileController with its types and keeps the person's services on their roles", () => {
    const schema = extract([
      file_ai_stigmer_agentic_file_v1_command,
      file_ai_stigmer_agentic_file_v1_query,
      file_ai_stigmer_agentic_file_v1_run_files,
    ]);

    expect(roles(schema)).toEqual({ FileCommandController: "command", FileQueryController: "query" });
    const types = typeNames(schema);
    for (const runnerType of ["MountRunFilesInput", "RunFileMounts", "CreateOutputUploadsInput", "OutputUploads", "RegisterOutputsInput", "RegisteredOutputs"]) {
      expect(types, runnerType).not.toContain(runnerType);
    }
  });

  it("drops the vault's VaultValueController and keeps every other service's role", () => {
    const schema = extract([
      file_ai_stigmer_agentic_vault_v1_command,
      file_ai_stigmer_agentic_vault_v1_connect_link,
      file_ai_stigmer_agentic_vault_v1_query,
      file_ai_stigmer_agentic_vault_v1_values,
    ]);

    expect(roles(schema)).toEqual({
      VaultCommandController: "command",
      ConnectLinkController: "connectLink",
      VaultQueryController: "query",
    });
    expect(typeNames(schema)).not.toContain("FetchExecutionValuesInput");
    expect(typeNames(schema)).not.toContain("ExecutionValues");
  });

  it("keeps the session's command service without appendEvents and claimInput", () => {
    const schema = extract([file_ai_stigmer_agentic_session_v1_command, file_ai_stigmer_agentic_session_v1_query]);

    expect(roles(schema)).toEqual({ SessionCommandController: "command", SessionQueryController: "query" });
    const commands = methodsOf(schema, "SessionCommandController");
    expect(commands).toContain("Create");
    expect(commands).not.toContain("AppendEvents");
    expect(commands).not.toContain("ClaimInput");
  });

  it("drops the Eval's RunEvalCaseController but keeps the archive link a person's getDownloadUrl answers", () => {
    const schema = extract([
      file_ai_stigmer_agentic_eval_v1_command,
      file_ai_stigmer_agentic_eval_v1_query,
      file_ai_stigmer_agentic_eval_v1_run_eval_case,
    ]);

    expect(roles(schema)).toEqual({ EvalCommandController: "command", EvalQueryController: "query" });
    expect(methodsOf(schema, "EvalQueryController")).toContain("GetDownloadUrl");
    expect(typeNames(schema)).toContain("EvalArchiveDownloadUrl");
    expect(typeNames(schema)).not.toContain("GetRunEvalCaseArchiveInput");
  });
});
