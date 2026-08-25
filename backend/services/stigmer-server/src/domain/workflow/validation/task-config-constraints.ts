/**
 * Declared task-config constraint validation — ports
 * ValidateTaskConfigConstraints from
 * pkg/domain/workflow/validation/task_config_constraints.go (stigmer#805).
 *
 * Layer 1 (RPC-level protovalidate) cannot see inside task_config because
 * it is an opaque google.protobuf.Struct on the wire; the rules declared on
 * the typed task-config protos (required fields, bounds, CEL rules like
 * wait's duration.non_zero) only become checkable after the strict
 * unmarshal. This step closes that gap for every task, including tasks
 * nested inside control-flow configs (for_each/fork/try_catch do blocks)
 * and compensate lists, which no other validation layer reaches.
 *
 * The rendered string is "task '<name>' (<kind>): <path> – <message>" —
 * the task prefix matches this package's other validators, the violation
 * half is the shared cross-edition formatViolation rendering. The Go and
 * cloud Java validators mirror this step byte-for-byte; the conformance
 * suite pins the exact string on both editions.
 *
 * A thrown error is a fault in the validation machinery itself (never a
 * user-fixable spec problem) and surfaces as a system error, mirroring the
 * Layer-1 contract.
 */
import { enumToJson } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";

import { WorkflowTaskKindSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type {
  WorkflowSpec,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { ForTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/for_pb";
import type { ForTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/for_pb";
import { ForkTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/fork_pb";
import type { ForkTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/fork_pb";
import { TryTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/try_pb";
import type { TryTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/try_pb";

import {
  taskConfigSchemaFor,
  unmarshalTaskConfig,
} from "../converter/unmarshal.js";
import { validator } from "../../../pipeline/steps/validation.js";
import { formatViolation } from "./format-violation.js";

/**
 * Runs protovalidate over every task's strict-unmarshaled typed config —
 * the declarative half of Layer-2 task-config validation.
 */
export function validateTaskConfigConstraints(
  spec: WorkflowSpec | undefined,
): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }

  const violations: string[] = [];
  for (const task of spec.tasks) {
    violations.push(...taskConstraintViolations(task));
  }
  return violations;
}

/**
 * Validates one task's typed config and recurses into the tasks nested
 * inside it. Iteration order is part of the cross-edition contract (the
 * persist gate surfaces errors[0]): the task's own violations first, then
 * nested tasks in declaration order, then the compensate list.
 */
function taskConstraintViolations(task: WorkflowTask): string[] {
  const out: string[] = [];

  if (task.taskConfig !== undefined) {
    let cfg: Message | undefined;
    try {
      cfg = unmarshalTaskConfig(task.kind, task.taskConfig);
    } catch {
      // An unmarshal failure is a structural defect the conversion step has
      // already reported as INVALID — never double-report it here.
      cfg = undefined;
    }
    if (cfg !== undefined) {
      for (const v of configConstraintViolations(task, cfg)) {
        out.push(
          `task '${task.name}' (${enumToJson(WorkflowTaskKindSchema, task.kind)}): ${v}`,
        );
      }
      for (const nested of nestedTasks(cfg)) {
        out.push(...taskConstraintViolations(nested));
      }
    }
  }

  for (const comp of task.compensate) {
    out.push(...taskConstraintViolations(comp));
  }

  return out;
}

/**
 * Runs the shared protovalidate validator over one typed task config.
 * protovalidate descends into nested messages on its own, so a parent
 * config's run also covers the scalar fields of tasks nested in it (their
 * task_config is a Struct again — that is what the walker's recursion is
 * for).
 */
function configConstraintViolations(task: WorkflowTask, cfg: Message): string[] {
  const schema = taskConfigSchemaFor(task.kind);
  if (schema === undefined) {
    // Unknown kinds were already rejected by validateTaskKinds; an
    // unmarshaled config without a schema is a machinery fault.
    throw new Error(`no task-config schema for kind ${task.kind}`);
  }

  const result = validator().validate(schema, cfg);
  if (result.kind === "valid") {
    return [];
  }
  if (result.kind === "invalid") {
    return result.error.violations.map((v) => formatViolation(v));
  }
  // Anything other than a validation verdict is a fault in the validation
  // machinery itself, not a user-fixable spec problem.
  throw result.error;
}

/**
 * The WorkflowTask lists embedded in a control-flow task config, in
 * declaration order — the same recursion set the converter walks
 * (convertForTask/convertForkTask/convertTryTask) and the cloud Java
 * TaskConfigStrictParser mirrors.
 */
function nestedTasks(cfg: Message): WorkflowTask[] {
  switch (cfg.$typeName) {
    case ForTaskConfigSchema.typeName:
      return (cfg as ForTaskConfig).do;
    case ForkTaskConfigSchema.typeName:
      return (cfg as ForkTaskConfig).branches.flatMap((branch) => branch.do);
    case TryTaskConfigSchema.typeName: {
      const tryCfg = cfg as TryTaskConfig;
      const out = [...tryCfg.try];
      if (tryCfg.catch !== undefined) {
        out.push(...tryCfg.catch.do);
      }
      return out;
    }
  }
  return [];
}
