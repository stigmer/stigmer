/**
 * Per-kind task converters — ports
 * pkg/domain/workflow/converter/task_converters.go. Each converter emits the
 * CNCF Serverless Workflow DSL fragment for one WorkflowTaskKind from the
 * strict-unmarshaled typed config. Field-presence gates mirror Go
 * line-for-line (a zero value that Go omits is omitted here) so the two
 * editions emit semantically identical documents.
 *
 * Nil-deref arms (sub-project DD-001, owner-ratified): Go dereferences
 * listen's `to` and emit_event's `event` without nil checks and PANICS on
 * their absence (verified by probe; the Go server has no panic recovery, so
 * the process crashes — filed as a Go bug). ConnectRPC catches thrown
 * errors, so this edition cannot crash the same way; these arms throw an
 * internal-style Error instead — the closest observable analog — rather
 * than inventing a user-facing INVALID arm Go does not have.
 */
import type { Message } from "@bufbuild/protobuf";
import { enumToJson, toJson } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import type { Value } from "@bufbuild/protobuf/wkt";
import { ValueSchema, timestampDate } from "@bufbuild/protobuf/wkt";

import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import { OnInvalidOutputPolicy } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/common_pb";
import { OnInvalidOutputPolicySchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/common_pb";
import type { EmitEventTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/emit_event_pb";
import type { EvalTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import {
  EvalFailPolicy,
  EvalFailPolicySchema,
  EvalScoringMode,
  EvalScoringModeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import type { ForTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/for_pb";
import type { ForkTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/fork_pb";
import type { GrpcCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/grpc_call_pb";
import type { HttpCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/http_call_pb";
import type { HumanInputTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";
import {
  HumanInputTimeoutPolicy,
  HumanInputTimeoutPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";
import type { ListenTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/listen_pb";
import type { LlmCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";
import type { NotificationTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/notification_pb";
import type { RaiseTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/raise_pb";
import type { RunTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/run_pb";
import type { SetTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/set_pb";
import type { SwitchTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/switch_pb";
import type { TransformTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/transform_pb";
import { TransformEngineSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/transform_pb";
import type { TryTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/try_pb";
import type { ValidateTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/validate_pb";
import {
  ValidationFailPolicy,
  ValidationFailPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/validate_pb";
import type { WaitTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/wait_pb";

import type { ConvertTaskList } from "./types.js";

/** One task definition fragment in the emitted document. */
export type YamlMap = Record<string, unknown>;

/**
 * Dispatches to the type-safe converter for the task kind — Go's
 * convertTaskByKind. `convertList` re-enters the task-list conversion for
 * the control-flow kinds' nested blocks (Go recurses through the Converter
 * receiver; here the cycle is an explicit parameter so the modules stay
 * import-acyclic).
 */
export function convertTaskByKind(
  kind: WorkflowTaskKind,
  typedProto: Message,
  convertList: ConvertTaskList,
): YamlMap {
  switch (kind) {
    case WorkflowTaskKind.set_vars:
      return convertSetTask(typedProto as SetTaskConfig);
    case WorkflowTaskKind.http_call:
      return convertHttpCallTask(typedProto as HttpCallTaskConfig);
    case WorkflowTaskKind.grpc_call:
      return convertGrpcCallTask(typedProto as GrpcCallTaskConfig);
    case WorkflowTaskKind.switch_case:
      return convertSwitchTask(typedProto as SwitchTaskConfig);
    case WorkflowTaskKind.for_each:
      return convertForTask(typedProto as ForTaskConfig, convertList);
    case WorkflowTaskKind.fork:
      return convertForkTask(typedProto as ForkTaskConfig, convertList);
    case WorkflowTaskKind.try_catch:
      return convertTryTask(typedProto as TryTaskConfig, convertList);
    case WorkflowTaskKind.listen:
      return convertListenTask(typedProto as ListenTaskConfig);
    case WorkflowTaskKind.wait:
      return convertWaitTask(typedProto as WaitTaskConfig);
    case WorkflowTaskKind.raise_error:
      return convertRaiseTask(typedProto as RaiseTaskConfig);
    case WorkflowTaskKind.run_workflow:
      return convertRunTask(typedProto as RunTaskConfig);
    case WorkflowTaskKind.agent_call:
      return convertAgentCallTask(typedProto as AgentCallTaskConfig);
    case WorkflowTaskKind.llm_call:
      return convertLlmCallTask(typedProto as LlmCallTaskConfig);
    case WorkflowTaskKind.transform:
      return convertTransformTask(typedProto as TransformTaskConfig);
    case WorkflowTaskKind.human_input:
      return convertHumanInputTask(typedProto as HumanInputTaskConfig);
    case WorkflowTaskKind.validate:
      return convertValidateTask(typedProto as ValidateTaskConfig);
    case WorkflowTaskKind.emit_event:
      return convertEmitEventTask(typedProto as EmitEventTaskConfig);
    case WorkflowTaskKind.notification:
      return convertNotificationTask(typedProto as NotificationTaskConfig);
    case WorkflowTaskKind.eval:
      return convertEvalTask(typedProto as EvalTaskConfig);
    case WorkflowTaskKind.activity_call:
      throw new Error("activity_call not yet implemented");
    default:
      throw new Error(
        `unsupported task kind: ${WorkflowTaskKind[kind] ?? kind}`,
      );
  }
}

function convertSetTask(cfg: SetTaskConfig): YamlMap {
  return { set: cfg.variables };
}

function convertHttpCallTask(cfg: HttpCallTaskConfig): YamlMap {
  const withBlock: YamlMap = { method: cfg.method };

  if (cfg.endpoint !== undefined) {
    withBlock["endpoint"] = { uri: cfg.endpoint.uri };
  }
  if (Object.keys(cfg.headers).length > 0) {
    withBlock["headers"] = cfg.headers;
  }
  if (cfg.timeoutSeconds > 0) {
    withBlock["timeout_seconds"] = cfg.timeoutSeconds;
  }
  const body = structAsMap(cfg.body);
  if (body !== undefined) {
    withBlock["body"] = body;
  }

  return { call: "http", with: withBlock };
}

function convertGrpcCallTask(cfg: GrpcCallTaskConfig): YamlMap {
  const withBlock: YamlMap = { service: cfg.service, method: cfg.method };

  const request = structAsMap(cfg.request);
  if (request !== undefined) {
    withBlock["request"] = request;
  }

  return { call: "grpc", with: withBlock };
}

function convertSwitchTask(cfg: SwitchTaskConfig): YamlMap {
  const items = cfg.cases.map((switchCase) => {
    const caseBody: YamlMap = {};
    if (switchCase.when !== "") {
      caseBody["when"] = switchCase.when;
    }
    if (switchCase.then !== "") {
      caseBody["then"] = switchCase.then;
    }
    const name = switchCase.name !== "" ? switchCase.name : "default";
    return { [name]: caseBody };
  });

  return { switch: items };
}

function convertForTask(
  cfg: ForTaskConfig,
  convertList: ConvertTaskList,
): YamlMap {
  const forMap: YamlMap = { in: cfg.in };
  if (cfg.each !== "") {
    forMap["each"] = cfg.each;
  }

  const result: YamlMap = { for: forMap };
  if (cfg.do.length > 0) {
    result["do"] = wrapNestedError("for_each do block", () =>
      convertList(cfg.do),
    );
  }
  return result;
}

function convertForkTask(
  cfg: ForkTaskConfig,
  convertList: ConvertTaskList,
): YamlMap {
  const branches = cfg.branches.map((branch) => {
    const branchBody: YamlMap = {};
    if (branch.do.length > 0) {
      branchBody["do"] = wrapNestedError(
        `fork branch "${branch.name}" do block`,
        () => convertList(branch.do),
      );
    }
    return { [branch.name]: branchBody };
  });

  const forkMap: YamlMap = { branches };
  if (cfg.compete) {
    forkMap["compete"] = true;
  }
  return { fork: forkMap };
}

function convertTryTask(
  cfg: TryTaskConfig,
  convertList: ConvertTaskList,
): YamlMap {
  const result: YamlMap = {};

  if (cfg.try.length > 0) {
    result["try"] = wrapNestedError("try block", () => convertList(cfg.try));
  }

  if (cfg.catch !== undefined) {
    const catchMap: YamlMap = {};
    if (cfg.catch.as !== "") {
      catchMap["as"] = cfg.catch.as;
    }
    if (cfg.catch.do.length > 0) {
      catchMap["do"] = wrapNestedError("catch block", () =>
        convertList(cfg.catch!.do),
      );
    }
    if (cfg.catch.compensate) {
      catchMap["compensate"] = true;
    }
    result["catch"] = catchMap;
  }

  return result;
}

function convertListenTask(cfg: ListenTaskConfig): YamlMap {
  if (cfg.to === undefined) {
    // Go panics here (nil deref) — DD-001: throw the internal-style analog.
    throw new Error("listen task config carries no 'to' block");
  }

  const eventFilters = cfg.to.signals.map((sig) => ({
    with: { id: sig.id, type: sig.type },
  }));

  const to: YamlMap = {};
  if (cfg.to.mode === "one" && eventFilters.length === 1) {
    to["one"] = eventFilters[0];
  } else if (cfg.to.mode === "one") {
    to["any"] = eventFilters;
  } else {
    to["all"] = eventFilters;
  }

  return { listen: { to } };
}

function convertWaitTask(cfg: WaitTaskConfig): YamlMap {
  switch (cfg.waitType.case) {
    case "duration": {
      const d = cfg.waitType.value;
      const duration: YamlMap = {};
      if (d.days > 0) {
        duration["days"] = d.days;
      }
      if (d.hours > 0) {
        duration["hours"] = d.hours;
      }
      if (d.minutes > 0) {
        duration["minutes"] = d.minutes;
      }
      if (d.seconds > 0) {
        duration["seconds"] = d.seconds;
      }
      if (d.milliseconds > 0) {
        duration["milliseconds"] = d.milliseconds;
      }
      return { wait: duration };
    }
    case "until":
      return { wait: rfc3339Seconds(timestampDate(cfg.waitType.value)) };
    default:
      return { wait: { seconds: 0 } };
  }
}

/**
 * Go renders wait-until with time.RFC3339 — seconds precision, "Z" for
 * UTC. Date#toISOString always carries milliseconds; strip them.
 */
function rfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const RAISE_ERROR_TYPE_MAPPING: Record<
  string,
  { typeUri: string; status: number }
> = {
  validationerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
    status: 400,
  },
  authenticationerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/authentication",
    status: 401,
  },
  authorizationerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/authorization",
    status: 403,
  },
  configurationerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/configuration",
    status: 400,
  },
  timeouterror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/timeout",
    status: 408,
  },
  communicationerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/communication",
    status: 502,
  },
  expressionerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/expression",
    status: 400,
  },
  runtimeerror: {
    typeUri: "https://serverlessworkflow.io/spec/1.0.0/errors/runtime",
    status: 500,
  },
};

function convertRaiseTask(cfg: RaiseTaskConfig): YamlMap {
  let typeUri = "https://serverlessworkflow.io/spec/1.0.0/errors/runtime";
  let status = 500;

  // hasOwn guards the prototype chain: an error named "constructor" (any
  // casing) must fall back to the runtime default like every other unknown
  // name, not resolve Object.prototype.constructor (panel finding).
  const key = cfg.error.toLowerCase();
  const mapped = Object.hasOwn(RAISE_ERROR_TYPE_MAPPING, key)
    ? RAISE_ERROR_TYPE_MAPPING[key]
    : undefined;
  if (mapped !== undefined) {
    typeUri = mapped.typeUri;
    status = mapped.status;
  } else if (cfg.error.startsWith("https://")) {
    typeUri = cfg.error;
  }

  const errorDef: YamlMap = { type: typeUri, status, title: cfg.error };
  if (cfg.message !== "") {
    errorDef["detail"] = cfg.message;
  }

  return { raise: { error: errorDef } };
}

function convertRunTask(cfg: RunTaskConfig): YamlMap {
  const run: YamlMap = { workflow: { name: cfg.workflow } };

  const input = structAsMap(cfg.input);
  if (input !== undefined) {
    run["with"] = input;
  }

  return { run };
}

function convertLlmCallTask(cfg: LlmCallTaskConfig): YamlMap {
  const withBlock: YamlMap = { model: cfg.model, prompt: cfg.prompt };

  if (cfg.systemPrompt !== "") {
    withBlock["system_prompt"] = cfg.systemPrompt;
  }
  const responseSchema = structAsMap(cfg.responseSchema);
  if (responseSchema !== undefined) {
    withBlock["response_schema"] = responseSchema;
  }
  if (cfg.temperature !== 0) {
    withBlock["temperature"] = cfg.temperature;
  }
  if (cfg.maxTokens > 0) {
    withBlock["max_tokens"] = cfg.maxTokens;
  }
  if (cfg.timeout > 0) {
    withBlock["timeout"] = cfg.timeout;
  }
  if (cfg.onInvalid !== OnInvalidOutputPolicy.ON_INVALID_POLICY_UNSPECIFIED) {
    withBlock["on_invalid"] = enumToJson(OnInvalidOutputPolicySchema, cfg.onInvalid);
  }
  if (cfg.maxRetries > 0) {
    withBlock["max_retries"] = cfg.maxRetries;
  }
  if (cfg.fallbackTask !== "") {
    withBlock["fallback_task"] = cfg.fallbackTask;
  }
  // int64 caps travel as bigint; practical values sit far below 2^53, so
  // the Number narrowing here cannot lose precision.
  if (cfg.maxCostMicros > 0n) {
    withBlock["max_cost_micros"] = Number(cfg.maxCostMicros);
  }
  if (cfg.maxTotalTokens > 0n) {
    withBlock["max_total_tokens"] = Number(cfg.maxTotalTokens);
  }

  return { call: "llm", with: withBlock };
}

function convertTransformTask(cfg: TransformTaskConfig): YamlMap {
  const withBlock: YamlMap = {
    engine: enumToJson(TransformEngineSchema, cfg.engine),
    expression: cfg.expression,
  };

  if (cfg.input !== "") {
    withBlock["input"] = cfg.input;
  }

  return { call: "transform", with: withBlock };
}

function convertHumanInputTask(cfg: HumanInputTaskConfig): YamlMap {
  const withBlock: YamlMap = { prompt: cfg.prompt };

  const formSchema = structAsMap(cfg.formSchema);
  if (formSchema !== undefined) {
    withBlock["form_schema"] = formSchema;
  }
  if (cfg.outcomes.length > 0) {
    withBlock["outcomes"] = cfg.outcomes.map((o) => {
      const om: YamlMap = { name: o.name };
      if (o.label !== "") {
        om["label"] = o.label;
      }
      if (o.then !== "") {
        om["then"] = o.then;
      }
      return om;
    });
  }
  if (cfg.approvers.length > 0) {
    withBlock["approvers"] = cfg.approvers;
  }
  if (cfg.timeout > 0) {
    withBlock["timeout"] = cfg.timeout;
  }
  if (cfg.onTimeout !== HumanInputTimeoutPolicy.HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED) {
    withBlock["on_timeout"] = enumToJson(HumanInputTimeoutPolicySchema, cfg.onTimeout);
  }
  if (cfg.notificationChannels.length > 0) {
    withBlock["notification_channels"] = cfg.notificationChannels;
  }
  if (cfg.payload !== undefined) {
    withBlock["payload"] = valueAsInterface(cfg.payload);
  }
  if (cfg.uiHint !== "") {
    withBlock["ui_hint"] = cfg.uiHint;
  }

  return { call: "human_input", with: withBlock };
}

function convertValidateTask(cfg: ValidateTaskConfig): YamlMap {
  const withBlock: YamlMap = { input: cfg.input };

  const schema = structAsMap(cfg.schema);
  if (schema !== undefined) {
    withBlock["schema"] = schema;
  }
  if (cfg.rules.length > 0) {
    withBlock["rules"] = cfg.rules.map((r) => {
      const rm: YamlMap = { name: r.name, expression: r.expression };
      if (r.message !== "") {
        rm["message"] = r.message;
      }
      return rm;
    });
  }
  if (cfg.onFail !== ValidationFailPolicy.VALIDATION_FAIL_POLICY_UNSPECIFIED) {
    withBlock["on_fail"] = enumToJson(ValidationFailPolicySchema, cfg.onFail);
  }
  if (cfg.fallbackTask !== "") {
    withBlock["fallback_task"] = cfg.fallbackTask;
  }

  return { call: "validate", with: withBlock };
}

function convertEmitEventTask(cfg: EmitEventTaskConfig): YamlMap {
  if (cfg.event === undefined) {
    // Go panics here (nil deref) — DD-001: throw the internal-style analog.
    throw new Error("emit_event task config carries no 'event' block");
  }

  const event: YamlMap = { type: cfg.event.type };
  if (cfg.event.source !== "") {
    event["source"] = cfg.event.source;
  }
  if (cfg.event.subject !== "") {
    event["subject"] = cfg.event.subject;
  }
  const data = structAsMap(cfg.event.data);
  if (data !== undefined) {
    event["data"] = data;
  }

  const withBlock: YamlMap = { event };

  // Delivery targets emit as the runner's DeliveryTarget union shape:
  // exactly one of {"webhook": {...}} or {"signal": {...}} per entry
  // (the runner discriminates structurally; keys are snake_case verbatim).
  if (cfg.delivery.length > 0) {
    const targets: YamlMap[] = [];
    for (const target of cfg.delivery) {
      switch (target.target.case) {
        case "webhook": {
          const webhook: YamlMap = { url: target.target.value.url };
          if (Object.keys(target.target.value.headers).length > 0) {
            webhook["headers"] = target.target.value.headers;
          }
          targets.push({ webhook });
          break;
        }
        case "signal":
          targets.push({
            signal: {
              execution_id: target.target.value.executionId,
              signal_name: target.target.value.signalName,
            },
          });
          break;
      }
    }
    withBlock["delivery"] = targets;
  }

  return { call: "emit_event", with: withBlock };
}

function convertNotificationTask(cfg: NotificationTaskConfig): YamlMap {
  const withBlock: YamlMap = {
    channel: cfg.channel,
    recipients: cfg.recipients,
    body: cfg.body,
  };

  if (cfg.subject !== "") {
    withBlock["subject"] = cfg.subject;
  }
  if (cfg.template !== "") {
    withBlock["template"] = cfg.template;
  }
  if (Object.keys(cfg.metadata).length > 0) {
    withBlock["metadata"] = cfg.metadata;
  }

  return { call: "notification", with: withBlock };
}

function convertEvalTask(cfg: EvalTaskConfig): YamlMap {
  const withBlock: YamlMap = {
    model: cfg.model,
    subject: cfg.subject,
    rubric: cfg.rubric,
  };

  if (cfg.scoringMode !== EvalScoringMode.EVAL_SCORING_MODE_UNSPECIFIED) {
    withBlock["scoring_mode"] = enumToJson(EvalScoringModeSchema, cfg.scoringMode);
  }
  if (cfg.threshold !== 0) {
    withBlock["threshold"] = cfg.threshold;
  }
  if (cfg.onFail !== EvalFailPolicy.EVAL_FAIL_POLICY_UNSPECIFIED) {
    withBlock["on_fail"] = enumToJson(EvalFailPolicySchema, cfg.onFail);
  }
  if (cfg.fallbackTask !== "") {
    withBlock["fallback_task"] = cfg.fallbackTask;
  }
  if (cfg.systemPrompt !== "") {
    withBlock["system_prompt"] = cfg.systemPrompt;
  }
  if (cfg.criteria.length > 0) {
    withBlock["criteria"] = cfg.criteria.map((cr) => {
      const cm: YamlMap = { name: cr.name, description: cr.description };
      if (cr.weight !== 0) {
        cm["weight"] = cr.weight;
      }
      return cm;
    });
  }
  if (cfg.maxCostMicros > 0n) {
    withBlock["max_cost_micros"] = Number(cfg.maxCostMicros);
  }

  return { call: "eval", with: withBlock };
}

/**
 * Emits the agent_call `with:` block.
 *
 * The emission contract is pinned across editions (issue #358): exactly
 * the declared AgentCallTaskConfig fields — agent, message, env,
 * run_config, output, harness, workspace_entries — and nothing else.
 * environment_refs are deliberately NOT emitted into execution YAML: the
 * runner never reads them; the execution-context step resolves them
 * server-side from the Workflow row, the same posture schedules use —
 * refs never travel with the run they credential.
 */
function convertAgentCallTask(cfg: AgentCallTaskConfig): YamlMap {
  const withBlock: YamlMap = { agent: cfg.agent, message: cfg.message };

  if (Object.keys(cfg.env).length > 0) {
    withBlock["env"] = cfg.env;
  }

  const rc = cfg.runConfig;
  if (rc !== undefined) {
    const runConfig: YamlMap = {};
    if (rc.modelName !== "") {
      runConfig["model_name"] = rc.modelName;
    }
    if (rc.maxCostUsd > 0) {
      runConfig["max_cost_usd"] = rc.maxCostUsd;
    }
    if (rc.maxToolRounds > 0) {
      runConfig["max_tool_rounds"] = rc.maxToolRounds;
    }
    // Emitted as the lowercase shorthand ("standard"/"fast"), the same
    // authoring idiom as harness below; the runner loader maps it back
    // to the canonical enum name.
    switch (rc.serviceTier) {
      case ServiceTier.STANDARD:
        runConfig["service_tier"] = "standard";
        break;
      case ServiceTier.FAST:
        runConfig["service_tier"] = "fast";
        break;
    }
    switch (rc.thinkingMode) {
      case ThinkingMode.DISABLED:
        runConfig["thinking_mode"] = "disabled";
        break;
      case ThinkingMode.ENABLED:
        runConfig["thinking_mode"] = "enabled";
        break;
    }
    if (Object.keys(runConfig).length > 0) {
      withBlock["run_config"] = runConfig;
    }
  }

  if (cfg.output !== undefined) {
    const output: YamlMap = {};
    if (cfg.output.schema !== undefined) {
      // Go emits the schema map unconditionally when present (no
      // emptiness gate here, unlike the other Struct fields).
      output["schema"] = cfg.output.schema;
    }
    if (cfg.output.onInvalid !== OnInvalidOutputPolicy.ON_INVALID_POLICY_UNSPECIFIED) {
      output["on_invalid"] = enumToJson(OnInvalidOutputPolicySchema, cfg.output.onInvalid);
    }
    if (cfg.output.maxRetries > 0) {
      output["max_retries"] = cfg.output.maxRetries;
    }
    if (cfg.output.fallbackTask !== "") {
      output["fallback_task"] = cfg.output.fallbackTask;
    }
    if (Object.keys(output).length > 0) {
      withBlock["output"] = output;
    }
  }

  switch (cfg.harness) {
    case Harness.NATIVE:
      withBlock["harness"] = "native";
      break;
    case Harness.CURSOR:
      withBlock["harness"] = "cursor";
      break;
  }

  if (cfg.workspaceEntries.length > 0) {
    const entries: YamlMap[] = [];
    for (const entry of cfg.workspaceEntries) {
      const m: YamlMap = {};
      if (entry.name !== "") {
        m["name"] = entry.name;
      }
      // Write-time validation guarantees git_repo sources only; a
      // local_path can only appear in a pre-validation spec and is
      // deliberately not emitted.
      if (entry.source?.source.case === "gitRepo") {
        const git = entry.source.source.value;
        const gitRepo: YamlMap = { url: git.url };
        if (git.branch !== "") {
          gitRepo["branch"] = git.branch;
        }
        m["source"] = { git_repo: gitRepo };
      }
      entries.push(m);
    }
    withBlock["workspace_entries"] = entries;
  }

  return { call: "agent", with: withBlock };
}

/**
 * Go's `cfg.X.AsMap()` with the `len(...) > 0` gate: the stubs surface
 * Struct fields as plain JsonObject already, so this is just the presence
 * + non-emptiness gate.
 */
function structAsMap(s: JsonObject | undefined): JsonObject | undefined {
  if (s === undefined) {
    return undefined;
  }
  return Object.keys(s).length > 0 ? s : undefined;
}

/** Go's `Value.AsInterface()`: the plain JSON value (null included). */
function valueAsInterface(v: Value): unknown {
  return toJson(ValueSchema, v);
}

/**
 * Mirrors Go's `fmt.Errorf("<context>: %w", err)` wrapping on nested
 * task-list conversion failures so the error chain reads identically.
 */
function wrapNestedError<T>(context: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new Error(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
