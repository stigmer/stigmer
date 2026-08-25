/**
 * Converter tests — port the Go golden coverage (converter_test.go) as
 * semantic-equivalence assertions: the emitted YAML is parsed back and
 * deep-compared, never byte-compared (sub-project DD-B: canonical
 * determinism is the contract, Go-emitter byte-parity deliberately is
 * not). Also pinned here: the #341 canonicalization rule — permuted
 * task-config key order must render identical bytes and therefore an
 * identical version hash — and the DD-001 nil-deref arms (Go panics;
 * this edition throws).
 */
import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  WorkflowSpecSchema,
  WorkflowTaskSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { protoToYaml } from "../converter.js";

function makeSpec(
  tasks: Array<{
    name: string;
    kind: WorkflowTaskKind;
    taskConfig?: JsonObject;
    export?: { as: string };
    flow?: { then: string };
    compensate?: Array<{ name: string; kind: WorkflowTaskKind; taskConfig?: JsonObject }>;
  }>,
): WorkflowSpec {
  return create(WorkflowSpecSchema, {
    document: { dsl: "1.0.0", namespace: "test", name: "t", version: "0.1.0" },
    tasks: tasks.map((t) => create(WorkflowTaskSchema, t)),
  });
}

function emit(spec: WorkflowSpec): string {
  return protoToYaml(spec);
}

/** The parsed `do:` entry for a task, keyed by its name. */
function taskDef(spec: WorkflowSpec, name: string): Record<string, unknown> {
  const doc = yaml.load(emit(spec)) as {
    do: Array<Record<string, Record<string, unknown>>>;
  };
  const entry = doc.do.find((e) => name in e);
  expect(entry, `task '${name}' present in do:`).toBeDefined();
  return entry![name]!;
}

describe("protoToYaml — document assembly", () => {
  it("emits document and do blocks; description only when set", () => {
    const spec = makeSpec([
      {
        name: "greet",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { greeting: "hello", count: "42" } },
      },
    ]);
    const doc = yaml.load(emit(spec)) as Record<string, unknown>;
    expect(doc["document"]).toEqual({
      dsl: "1.0.0",
      namespace: "test",
      name: "t",
      version: "0.1.0",
    });
    expect(Array.isArray(doc["do"])).toBe(true);

    spec.document!.description = "a workflow";
    const withDesc = yaml.load(emit(spec)) as { document: Record<string, unknown> };
    expect(withDesc.document["description"]).toBe("a workflow");
  });

  it.each([
    ["nil spec", undefined, /workflow spec cannot be nil/],
    [
      "nil document",
      create(WorkflowSpecSchema, {
        tasks: [{ name: "x", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } }],
      }),
      /workflow document cannot be nil/,
    ],
    [
      "no tasks",
      create(WorkflowSpecSchema, {
        document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      }),
      /workflow must have at least one task/,
    ],
  ])("refuses %s", (_case, spec, message) => {
    expect(() => protoToYaml(spec as WorkflowSpec | undefined)).toThrow(message);
  });

  it("wraps task failures with the Go error chain shape", () => {
    const spec = makeSpec([
      {
        name: "bad",
        kind: WorkflowTaskKind.llm_call,
        taskConfig: { model: "m", prompt: "p", not_a_field: true },
      },
    ]);
    expect(() => emit(spec)).toThrow(
      /^failed to convert task 'bad': failed to unmarshal task 'bad' config: failed to unmarshal JSON to proto: /,
    );
  });

  it("requires a task name", () => {
    const spec = makeSpec([
      { name: "", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
    ]);
    expect(() => emit(spec)).toThrow(/task name is required/);
  });
});

describe("protoToYaml — canonical determinism (the #341 rule, DD-B)", () => {
  it("permuted task-config key order renders identical bytes and hash", () => {
    const a = makeSpec([
      {
        name: "seed",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { alpha: "1", beta: "2", gamma: "3" } },
      },
    ]);
    const b = makeSpec([
      {
        name: "seed",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { gamma: "3", beta: "2", alpha: "1" } },
      },
    ]);

    const yamlA = emit(a);
    const yamlB = emit(b);
    expect(yamlB).toBe(yamlA);

    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(hash(yamlB)).toBe(hash(yamlA));
  });

  it("renders map keys sorted at every depth", () => {
    const spec = makeSpec([
      {
        name: "fetch",
        kind: WorkflowTaskKind.http_call,
        taskConfig: {
          method: "POST",
          endpoint: { uri: "https://api.example.com" },
          body: { zulu: "z", alpha: "a", mid: { b: 1, a: 2 } },
        },
      },
    ]);
    const text = emit(spec);
    // Top level: "do" sorts before "document".
    expect(text.indexOf("do:")).toBeLessThan(text.indexOf("document:"));
    // Nested body keys: alpha before zulu.
    expect(text.indexOf("alpha: a")).toBeLessThan(text.indexOf("zulu: z"));
  });

  it("repeated emission is byte-stable", () => {
    const spec = makeSpec([
      {
        name: "greet",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { k: "v" } },
      },
    ]);
    expect(emit(spec)).toBe(emit(spec));
  });
});

describe("task envelope: export, then, compensate", () => {
  it("emits export.as and then only when set, and compensate under metadata", () => {
    const spec = makeSpec([
      {
        name: "fetch",
        kind: WorkflowTaskKind.http_call,
        taskConfig: { method: "GET", endpoint: { uri: "https://x.test" } },
        export: { as: "${ . }" },
        flow: { then: "next" },
        compensate: [
          {
            name: "undo",
            kind: WorkflowTaskKind.set_vars,
            taskConfig: { variables: { rolled: "back" } },
          },
        ],
      },
      {
        name: "next",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: {} },
      },
    ]);

    const fetchDef = taskDef(spec, "fetch");
    expect(fetchDef["export"]).toEqual({ as: "${ . }" });
    expect(fetchDef["then"]).toBe("next");
    const metadata = fetchDef["metadata"] as Record<string, unknown>;
    expect(metadata["__stigmer_compensate"]).toEqual([
      { undo: { set: { rolled: "back" } } },
    ]);

    const nextDef = taskDef(spec, "next");
    expect("export" in nextDef).toBe(false);
    expect("then" in nextDef).toBe(false);
    expect("metadata" in nextDef).toBe(false);
  });
});

describe("per-kind emission", () => {
  it("set_vars: variables verbatim (empty map included)", () => {
    expect(
      taskDef(
        makeSpec([
          {
            name: "s",
            kind: WorkflowTaskKind.set_vars,
            taskConfig: { variables: {} },
          },
        ]),
        "s",
      ),
    ).toEqual({ set: {} });
  });

  it("http_call: presence gates on headers/timeout/body", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "h",
          kind: WorkflowTaskKind.http_call,
          taskConfig: {
            method: "POST",
            endpoint: { uri: "https://x.test/data" },
            headers: { "X-Auth": "t" },
            timeout_seconds: 30,
            body: { key: "value" },
          },
        },
      ]),
      "h",
    );
    expect(def).toEqual({
      call: "http",
      with: {
        method: "POST",
        endpoint: { uri: "https://x.test/data" },
        headers: { "X-Auth": "t" },
        timeout_seconds: 30,
        body: { key: "value" },
      },
    });

    const minimal = taskDef(
      makeSpec([
        {
          name: "h",
          kind: WorkflowTaskKind.http_call,
          taskConfig: { method: "GET", endpoint: { uri: "https://x.test" }, body: {} },
        },
      ]),
      "h",
    );
    expect(minimal["with"]).toEqual({
      method: "GET",
      endpoint: { uri: "https://x.test" },
    });
  });

  it("grpc_call: service/method with optional request", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "g",
          kind: WorkflowTaskKind.grpc_call,
          taskConfig: { service: "svc.v1.Api", method: "Get", request: { id: "1" } },
        },
      ]),
      "g",
    );
    expect(def).toEqual({
      call: "grpc",
      with: { service: "svc.v1.Api", method: "Get", request: { id: "1" } },
    });
  });

  it("switch_case: named and default cases with when/then gates", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "sw",
          kind: WorkflowTaskKind.switch_case,
          taskConfig: {
            cases: [
              { name: "high", when: "$x > 1", then: "a" },
              { then: "b" },
            ],
          },
        },
        { name: "a", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
        { name: "b", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
      ]),
      "sw",
    );
    expect(def).toEqual({
      switch: [{ high: { when: "$x > 1", then: "a" } }, { default: { then: "b" } }],
    });
  });

  it("for_each / fork / try_catch: nested task lists recurse", () => {
    const forDef = taskDef(
      makeSpec([
        {
          name: "loop",
          kind: WorkflowTaskKind.for_each,
          taskConfig: {
            in: "${ .items }",
            each: "item",
            do: [
              {
                name: "body",
                kind: "set_vars",
                task_config: { variables: { v: "1" } },
              },
            ],
          },
        },
      ]),
      "loop",
    );
    expect(forDef).toEqual({
      for: { in: "${ .items }", each: "item" },
      do: [{ body: { set: { v: "1" } } }],
    });

    const forkDef = taskDef(
      makeSpec([
        {
          name: "par",
          kind: WorkflowTaskKind.fork,
          taskConfig: {
            compete: true,
            branches: [
              {
                name: "left",
                do: [
                  { name: "l1", kind: "set_vars", task_config: { variables: {} } },
                ],
              },
            ],
          },
        },
      ]),
      "par",
    );
    expect(forkDef).toEqual({
      fork: { branches: [{ left: { do: [{ l1: { set: {} } }] } }], compete: true },
    });

    const tryDef = taskDef(
      makeSpec([
        {
          name: "guard",
          kind: WorkflowTaskKind.try_catch,
          taskConfig: {
            try: [{ name: "t1", kind: "set_vars", task_config: { variables: {} } }],
            catch: {
              as: "err",
              compensate: true,
              do: [{ name: "c1", kind: "set_vars", task_config: { variables: {} } }],
            },
          },
        },
      ]),
      "guard",
    );
    expect(tryDef).toEqual({
      try: [{ t1: { set: {} } }],
      catch: { as: "err", do: [{ c1: { set: {} } }], compensate: true },
    });
  });

  it("listen: one/any/all mode mapping", () => {
    const one = taskDef(
      makeSpec([
        {
          name: "l",
          kind: WorkflowTaskKind.listen,
          taskConfig: {
            to: { mode: "one", signals: [{ id: "s1", type: "t1" }] },
          },
        },
      ]),
      "l",
    );
    expect(one).toEqual({
      listen: { to: { one: { with: { id: "s1", type: "t1" } } } },
    });

    const any = taskDef(
      makeSpec([
        {
          name: "l",
          kind: WorkflowTaskKind.listen,
          taskConfig: {
            to: {
              mode: "one",
              signals: [
                { id: "s1", type: "t1" },
                { id: "s2", type: "t2" },
              ],
            },
          },
        },
      ]),
      "l",
    );
    expect(any["listen"]).toEqual({
      to: {
        any: [{ with: { id: "s1", type: "t1" } }, { with: { id: "s2", type: "t2" } }],
      },
    });

    const all = taskDef(
      makeSpec([
        {
          name: "l",
          kind: WorkflowTaskKind.listen,
          taskConfig: {
            to: { mode: "all", signals: [{ id: "s1", type: "t1" }] },
          },
        },
      ]),
      "l",
    );
    expect(all["listen"]).toEqual({ to: { all: [{ with: { id: "s1", type: "t1" } }] } });
  });

  it("listen/emit_event with the missing required block throw (DD-001: Go panics)", () => {
    expect(() =>
      emit(makeSpec([{ name: "l", kind: WorkflowTaskKind.listen, taskConfig: {} }])),
    ).toThrow(/listen task config carries no 'to' block/);
    expect(() =>
      emit(makeSpec([{ name: "e", kind: WorkflowTaskKind.emit_event, taskConfig: {} }])),
    ).toThrow(/emit_event task config carries no 'event' block/);
  });

  it("wait: duration gates zeros, until renders RFC3339 seconds, empty defaults to seconds 0", () => {
    const duration = taskDef(
      makeSpec([
        {
          name: "w",
          kind: WorkflowTaskKind.wait,
          taskConfig: { duration: { hours: 1, seconds: 30 } },
        },
      ]),
      "w",
    );
    expect(duration).toEqual({ wait: { hours: 1, seconds: 30 } });

    // The Timestamp JSON form is an RFC3339 string; the emission drops
    // sub-second precision (Go time.RFC3339).
    const until = taskDef(
      makeSpec([
        {
          name: "w",
          kind: WorkflowTaskKind.wait,
          taskConfig: { until: "2026-03-01T10:20:30.500Z" },
        },
      ]),
      "w",
    );
    expect(until).toEqual({ wait: "2026-03-01T10:20:30Z" });

    const empty = taskDef(
      makeSpec([{ name: "w", kind: WorkflowTaskKind.wait, taskConfig: {} }]),
      "w",
    );
    expect(empty).toEqual({ wait: { seconds: 0 } });
  });

  it("raise_error: known names map to spec URIs, https passes through, unknown falls back to runtime", () => {
    const known = taskDef(
      makeSpec([
        {
          name: "r",
          kind: WorkflowTaskKind.raise_error,
          taskConfig: { error: "ValidationError", message: "bad input" },
        },
      ]),
      "r",
    );
    expect(known).toEqual({
      raise: {
        error: {
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
          status: 400,
          title: "ValidationError",
          detail: "bad input",
        },
      },
    });

    const custom = taskDef(
      makeSpec([
        {
          name: "r",
          kind: WorkflowTaskKind.raise_error,
          taskConfig: { error: "https://errors.example.com/custom" },
        },
      ]),
      "r",
    );
    expect((custom["raise"] as { error: Record<string, unknown> }).error).toEqual({
      type: "https://errors.example.com/custom",
      status: 500,
      title: "https://errors.example.com/custom",
    });

    const unknown = taskDef(
      makeSpec([
        {
          name: "r",
          kind: WorkflowTaskKind.raise_error,
          taskConfig: { error: "SomethingElse" },
        },
      ]),
      "r",
    );
    expect((unknown["raise"] as { error: Record<string, unknown> }).error).toEqual({
      type: "https://serverlessworkflow.io/spec/1.0.0/errors/runtime",
      status: 500,
      title: "SomethingElse",
    });

    // Prototype-chain probe: "Constructor" must take the runtime fallback,
    // never resolve Object.prototype.constructor (panel finding).
    const proto = taskDef(
      makeSpec([
        {
          name: "r",
          kind: WorkflowTaskKind.raise_error,
          taskConfig: { error: "Constructor" },
        },
      ]),
      "r",
    );
    expect((proto["raise"] as { error: Record<string, unknown> }).error).toEqual({
      type: "https://serverlessworkflow.io/spec/1.0.0/errors/runtime",
      status: 500,
      title: "Constructor",
    });
  });

  it("run_workflow: name plus optional with", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "sub",
          kind: WorkflowTaskKind.run_workflow,
          taskConfig: { workflow: "child", input: { a: 1 } },
        },
      ]),
      "sub",
    );
    expect(def).toEqual({
      run: { workflow: { name: "child" }, with: { a: 1 } },
    });
  });

  it("llm_call: full field-presence contract incl. int64 caps and enum names", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "llm",
          kind: WorkflowTaskKind.llm_call,
          taskConfig: {
            model: "openai/gpt-6",
            prompt: "p",
            system_prompt: "sys",
            response_schema: { type: "object" },
            temperature: 0.5,
            max_tokens: 100,
            timeout: 60,
            on_invalid: "ON_INVALID_RETRY",
            max_retries: 3,
            fallback_task: "fb",
            max_cost_micros: "5000000",
            max_total_tokens: "9000",
          },
        },
        { name: "fb", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
      ]),
      "llm",
    );
    expect(def).toEqual({
      call: "llm",
      with: {
        model: "openai/gpt-6",
        prompt: "p",
        system_prompt: "sys",
        response_schema: { type: "object" },
        temperature: 0.5,
        max_tokens: 100,
        timeout: 60,
        on_invalid: "ON_INVALID_RETRY",
        max_retries: 3,
        fallback_task: "fb",
        max_cost_micros: 5000000,
        max_total_tokens: 9000,
      },
    });
  });

  it("transform: engine always emitted (enum name), input gated", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "t",
          kind: WorkflowTaskKind.transform,
          taskConfig: { engine: "TRANSFORM_ENGINE_JQ", expression: ".a" },
        },
      ]),
      "t",
    );
    expect(def).toEqual({
      call: "transform",
      with: { engine: "TRANSFORM_ENGINE_JQ", expression: ".a" },
    });
  });

  it("human_input: outcomes/approvers/timeout/policy/channels/payload/ui_hint gates", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "gate",
          kind: WorkflowTaskKind.human_input,
          taskConfig: {
            prompt: "approve?",
            outcomes: [
              { name: "approve", label: "OK", then: "done" },
              { name: "reject" },
            ],
            approvers: ["ops"],
            timeout: 3600,
            on_timeout: "HUMAN_INPUT_TIMEOUT_FAIL",
            notification_channels: ["email"],
            payload: { ticket: 7 },
            ui_hint: "modal",
          },
        },
        { name: "done", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
      ]),
      "gate",
    );
    expect(def).toEqual({
      call: "human_input",
      with: {
        prompt: "approve?",
        outcomes: [
          { name: "approve", label: "OK", then: "done" },
          { name: "reject" },
        ],
        approvers: ["ops"],
        timeout: 3600,
        on_timeout: "HUMAN_INPUT_TIMEOUT_FAIL",
        notification_channels: ["email"],
        payload: { ticket: 7 },
        ui_hint: "modal",
      },
    });
  });

  it("validate: schema/rules/on_fail/fallback gates", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "v",
          kind: WorkflowTaskKind.validate,
          taskConfig: {
            input: "${ . }",
            schema: { type: "object" },
            rules: [
              { name: "r1", expression: ".x > 0", message: "x must be positive" },
              { name: "r2", expression: ".y != null" },
            ],
            on_fail: "VALIDATION_FAIL_WARN",
            fallback_task: "fb",
          },
        },
        { name: "fb", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
      ]),
      "v",
    );
    expect(def).toEqual({
      call: "validate",
      with: {
        input: "${ . }",
        schema: { type: "object" },
        rules: [
          { name: "r1", expression: ".x > 0", message: "x must be positive" },
          { name: "r2", expression: ".y != null" },
        ],
        on_fail: "VALIDATION_FAIL_WARN",
        fallback_task: "fb",
      },
    });
  });

  it("emit_event: event gates and the structural delivery-target union", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "e",
          kind: WorkflowTaskKind.emit_event,
          taskConfig: {
            event: {
              type: "order.created",
              source: "shop",
              subject: "o-1",
              data: { total: 9 },
            },
            delivery: [
              { webhook: { url: "https://hook.test", headers: { "X-K": "v" } } },
              { signal: { execution_id: "we-1", signal_name: "order" } },
            ],
          },
        },
      ]),
      "e",
    );
    expect(def).toEqual({
      call: "emit_event",
      with: {
        event: {
          type: "order.created",
          source: "shop",
          subject: "o-1",
          data: { total: 9 },
        },
        delivery: [
          { webhook: { url: "https://hook.test", headers: { "X-K": "v" } } },
          { signal: { execution_id: "we-1", signal_name: "order" } },
        ],
      },
    });
  });

  it("notification: channel/recipients/body always, subject/template/metadata gated", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "n",
          kind: WorkflowTaskKind.notification,
          taskConfig: {
            channel: "email",
            recipients: ["a@x.test"],
            body: "hi",
            subject: "s",
            metadata: { k: "v" },
          },
        },
      ]),
      "n",
    );
    expect(def).toEqual({
      call: "notification",
      with: {
        channel: "email",
        recipients: ["a@x.test"],
        body: "hi",
        subject: "s",
        metadata: { k: "v" },
      },
    });
  });

  it("eval: scoring/threshold/criteria gates incl. weightless criteria", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "judge",
          kind: WorkflowTaskKind.eval,
          taskConfig: {
            model: "openai/gpt-6",
            subject: "${ .answer }",
            rubric: "grade it",
            scoring_mode: "EVAL_MULTI_CRITERIA",
            threshold: 0.8,
            criteria: [
              { name: "accuracy", description: "d", weight: 0.7 },
              { name: "tone", description: "d2" },
            ],
            max_cost_micros: "1000",
          },
        },
      ]),
      "judge",
    );
    expect(def).toEqual({
      call: "eval",
      with: {
        model: "openai/gpt-6",
        subject: "${ .answer }",
        rubric: "grade it",
        scoring_mode: "EVAL_MULTI_CRITERIA",
        threshold: 0.8,
        criteria: [
          { name: "accuracy", description: "d", weight: 0.7 },
          { name: "tone", description: "d2" },
        ],
        max_cost_micros: 1000,
      },
    });
  });

  it("activity_call refuses (not yet implemented, Go parity)", () => {
    expect(() =>
      emit(
        makeSpec([
          { name: "a", kind: WorkflowTaskKind.activity_call, taskConfig: {} },
        ]),
      ),
    ).toThrow(/activity_call not yet implemented/);
  });
});

describe("agent_call emission (the #358 pinned contract)", () => {
  it("emits exactly the declared fields with lowercase shorthands", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "call",
          kind: WorkflowTaskKind.agent_call,
          taskConfig: {
            agent: "triage",
            message: "Analyze: ${ .body }",
            env: { REGION: "us" },
            run_config: {
              model_name: "anthropic/claude-4",
              max_cost_usd: 2.5,
              max_tool_rounds: 10,
              service_tier: "fast",
              thinking_mode: "enabled",
            },
            output: {
              schema: { type: "object" },
              on_invalid: "ON_INVALID_RETRY",
              max_retries: 3,
              fallback_task: "review",
            },
            harness: "cursor",
            workspace_entries: [
              {
                name: "repo",
                source: { git_repo: { url: "https://github.com/x/y", branch: "main" } },
              },
            ],
            environment_refs: [{ slug: "prod" }],
          },
        },
        { name: "review", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: {} } },
      ]),
      "call",
    );
    expect(def).toEqual({
      call: "agent",
      with: {
        agent: "triage",
        message: "Analyze: ${ .body }",
        env: { REGION: "us" },
        run_config: {
          model_name: "anthropic/claude-4",
          max_cost_usd: 2.5,
          max_tool_rounds: 10,
          service_tier: "fast",
          thinking_mode: "enabled",
        },
        output: {
          schema: { type: "object" },
          on_invalid: "ON_INVALID_RETRY",
          max_retries: 3,
          fallback_task: "review",
        },
        harness: "cursor",
        workspace_entries: [
          {
            name: "repo",
            source: { git_repo: { url: "https://github.com/x/y", branch: "main" } },
          },
        ],
        // environment_refs deliberately absent: refs never travel with the
        // run they credential.
      },
    });
  });

  it("omits empty run_config/output/harness and accepts case-insensitive shorthands", () => {
    const def = taskDef(
      makeSpec([
        {
          name: "call",
          kind: WorkflowTaskKind.agent_call,
          taskConfig: {
            agent: "a",
            message: "m",
            run_config: {},
            harness: "Native",
          },
        },
      ]),
      "call",
    );
    expect(def).toEqual({
      call: "agent",
      with: { agent: "a", message: "m", harness: "native" },
    });
  });
});
