// Canonical valid Workflow fixtures for the conformance suite.
// Domain: conformance support.
//
// Workflow is the first versioned domain, and its spec is far richer than the
// flat tenancy resources — a document block plus at least one task. These
// builders give the suite one canonical *valid* workflow so version and CRUD
// tests share a single source of truth and vary it deliberately (e.g. change
// `taskVar` to alter the generated CNCF YAML, which changes the version hash —
// the lever the version-history tests pull to force or avoid a new version).
//
// Negative cases (missing spec, missing name, malformed input) are written
// inline in the suite, not here: this module represents validity by construction.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

export const WORKFLOW_API_VERSION = "agentic.stigmer.ai/v1";
export const WORKFLOW_KIND = "Workflow";

export interface WorkflowSpecOptions {
  // CNCF document namespace; defaults to a stable placeholder.
  namespace?: string;
  // Logical workflow name inside the document block.
  documentName?: string;
  // Value of the single set_vars variable. Changing it changes the generated
  // YAML and therefore the version hash — used to force a new version, or keep
  // it identical to assert idempotency.
  taskVar?: string;
}

// A valid single-task WorkflowSpec: one `set_vars` task whose config is a
// google.protobuf.Struct (protobuf-es accepts a plain JSON object for Struct
// fields in the init shape).
export function makeWorkflowSpec(opts: WorkflowSpecOptions = {}): MessageInitShape<typeof WorkflowSpecSchema> {
  return {
    description: "conformance fixture",
    document: {
      dsl: "1.0.0",
      namespace: opts.namespace ?? "conformance",
      name: opts.documentName ?? "conformance-workflow",
      version: "1.0.0",
    },
    tasks: [
      {
        name: "setVars",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { greeting: opts.taskVar ?? "hello" } },
        export: { as: "${ . }" },
      },
    ],
  };
}

export interface WorkflowOptions extends WorkflowSpecOptions {
  org: string;
  name: string;
  // Apply-time version tag, recorded on the archived version via
  // metadata.version.tag. OSS sets tags this way; the dedicated tagVersion RPC
  // is unimplemented locally.
  tag?: string;
}

// A complete, valid Workflow resource ready to hand to create/apply/update.
export function makeWorkflow(opts: WorkflowOptions): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, tag, namespace, documentName, taskVar } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: {
      name,
      org,
      ...(tag !== undefined ? { version: { tag } } : {}),
    },
    spec: makeWorkflowSpec({
      namespace: namespace ?? org,
      documentName: documentName ?? name,
      taskVar,
    }),
  };
}
