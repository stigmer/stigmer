import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowFromYaml } from "../loader.js";

const GOLDEN_DIR = join(
  import.meta.dirname,
  "../../../test/golden",
);

function loadGolden(filename: string): string {
  return readFileSync(join(GOLDEN_DIR, filename), "utf-8");
}

describe("loadWorkflowFromYaml", () => {
  describe("golden YAML parsing", () => {
    it("parses 01-operation-basic.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("01-operation-basic.yaml"));

      expect(model.document.name).toBe("operation-basic");
      expect(model.document.dsl).toBe("1.0.0");
      expect(model.document.namespace).toBe("golden-tests");
      expect(model.do).toHaveLength(3);
      expect(model.do[0].key).toBe("initialize");
      expect(model.do[0].task.kind).toBe("set");
      expect(model.do[1].key).toBe("hello");
      expect(model.do[2].key).toBe("finalize");
    });

    it("parses 02-switch-conditional.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("02-switch-conditional.yaml"));

      expect(model.document.name).toBe("switch-conditional-test");
      expect(model.do).toHaveLength(5);

      expect(model.do[0].key).toBe("fetchPost");
      expect(model.do[0].task.kind).toBe("call:http");

      expect(model.do[1].key).toBe("classifyUser");
      expect(model.do[1].task.kind).toBe("switch");
      if (model.do[1].task.kind === "switch") {
        expect(model.do[1].task.switch).toHaveLength(3);
        expect(model.do[1].task.switch[0].name).toBe("highValueCase");
        expect(model.do[1].task.switch[0].when).toBe("${ $context.userId > 5 }");
        expect(model.do[1].task.switch[0].then).toBe("highValueUser");
      }

      expect(model.do[2].task.then).toBe("end");
    });

    it("parses 03-foreach-loop.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("03-foreach-loop.yaml"));

      expect(model.document.name).toBe("foreach-loop-test");

      const forTask = model.do.find((t) => t.task.kind === "for");
      expect(forTask).toBeDefined();
      if (forTask?.task.kind === "for") {
        expect(forTask.task.for.in).toBeDefined();
        expect(forTask.task.do).toBeDefined();
      }
    });

    it("parses 04-parallel-concurrent.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("04-parallel-concurrent.yaml"));
      const forkTask = model.do.find((t) => t.task.kind === "fork");
      expect(forkTask).toBeDefined();
    });

    it("parses 05-event-signal.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("05-event-signal.yaml"));
      const listenTask = model.do.find((t) => t.task.kind === "listen");
      expect(listenTask).toBeDefined();
    });

    it("parses 06-sleep-delay.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("06-sleep-delay.yaml"));
      const waitTask = model.do.find((t) => t.task.kind === "wait");
      expect(waitTask).toBeDefined();
    });

    it("parses 07-inject-transform.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("07-inject-transform.yaml"));
      expect(model.do[0].task.kind).toBe("set");
      if (model.do[0].task.kind === "set") {
        expect(model.do[0].task.set.computed).toBe("${ .a + .b }");
        expect(model.do[0].task.set.timestamp).toBe("${ now }");
      }
    });

    it("parses 08-error-retry.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("08-error-retry.yaml"));
      const tryTask = model.do.find((t) => t.task.kind === "try");
      expect(tryTask).toBeDefined();
    });

    it("parses 09-nested-states.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("09-nested-states.yaml"));
      expect(model.do.length).toBeGreaterThan(0);

      const switchTask = model.do.find((t) => t.task.kind === "switch");
      expect(switchTask).toBeDefined();

      const exportTask = model.do.find(
        (t) => t.task.export?.as !== undefined,
      );
      expect(exportTask).toBeDefined();
    });

    it("parses 10-complex-workflow.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("10-complex-workflow.yaml"));
      expect(model.do.length).toBeGreaterThan(3);

      const switchTask = model.do.find((t) => t.task.kind === "switch");
      const forkTask = model.do.find((t) => t.task.kind === "fork");
      const listenTask = model.do.find((t) => t.task.kind === "listen");

      expect(switchTask).toBeDefined();
      expect(forkTask).toBeDefined();
      expect(listenTask).toBeDefined();
    });

    it("parses 11-claimcheck-large-payload.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("11-claimcheck-large-payload.yaml"));
      expect(model.do.length).toBeGreaterThan(0);
      const httpTasks = model.do.filter((t) => t.task.kind === "call:http");
      expect(httpTasks.length).toBeGreaterThanOrEqual(2);
    });

    it("parses 12-claimcheck-between-steps.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("12-claimcheck-between-steps.yaml"));
      expect(model.do.length).toBeGreaterThan(0);
    });
  });

  describe("DSL version validation", () => {
    it("accepts DSL 1.0.0", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - step:
      set:
        x: 1
`;
      expect(() => loadWorkflowFromYaml(yaml)).not.toThrow();
    });

    it("accepts DSL 1.5.0", () => {
      const yaml = `
document:
  dsl: '1.5.0'
  name: test
do:
  - step:
      set:
        x: 1
`;
      expect(() => loadWorkflowFromYaml(yaml)).not.toThrow();
    });

    it("rejects DSL 0.8.0", () => {
      const yaml = `
document:
  dsl: '0.8.0'
  name: test
do:
  - step:
      set:
        x: 1
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("Unsupported DSL version");
    });

    it("rejects DSL 2.0.0", () => {
      const yaml = `
document:
  dsl: '2.0.0'
  name: test
do:
  - step:
      set:
        x: 1
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("Unsupported DSL version");
    });
  });

  describe("error handling", () => {
    it("rejects empty YAML", () => {
      expect(() => loadWorkflowFromYaml("")).toThrow();
    });

    it("rejects YAML without document", () => {
      const yaml = `
do:
  - step:
      set:
        x: 1
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("document");
    });

    it("rejects YAML without do", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow();
    });

    it("rejects unrecognized task type", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - step:
      unknownType: true
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("Cannot determine task type");
    });
  });

  describe("task type discrimination", () => {
    it("discriminates set tasks", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - step:
      set:
        x: 1
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("set");
    });

    it("discriminates switch tasks", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - decide:
      switch:
        - always:
            when: \${ 1 == 1 }
            then: end
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("switch");
    });

    it("discriminates call:http tasks", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - fetch:
      call: http
      with:
        method: GET
        endpoint:
          uri: https://example.com
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("call:http");
    });

    it("discriminates call:agent tasks", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: my-agent
        message: "Do something"
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("call:agent");
      if (model.do[0].task.kind === "call:agent") {
        expect(model.do[0].task.call).toBe("agent");
        expect(model.do[0].task.with.agent).toBe("my-agent");
        expect(model.do[0].task.with.message).toBe("Do something");
      }
    });

    it("discriminates custom call:function tasks", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: transform
      with:
        template: my-template
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("call:function");
      if (model.do[0].task.kind === "call:function") {
        expect(model.do[0].task.call).toBe("transform");
      }
    });

    it("preserves task base properties", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - step:
      set:
        x: 1
      if: \${ 1 == 1 }
      then: end
      export:
        as: \${ . }
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.if).toBe("${ 1 == 1 }");
      expect(model.do[0].task.then).toBe("end");
      expect(model.do[0].task.export?.as).toBe("${ . }");
    });

    it("discriminates for tasks with all config options", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - loop:
      for:
        each: pet
        in: \${ $data.pets }
        at: idx
      while: \${ $data.idx < 10 }
      do:
        - process:
            set:
              name: \${ $data.pet }
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("for");
      if (model.do[0].task.kind === "for") {
        expect(model.do[0].task.for.each).toBe("pet");
        expect(model.do[0].task.for.in).toBe("${ $data.pets }");
        expect(model.do[0].task.for.at).toBe("idx");
        expect(model.do[0].task.while).toBe("${ $data.idx < 10 }");
        expect(model.do[0].task.do).toHaveLength(1);
        expect(model.do[0].task.do[0].key).toBe("process");
        expect(model.do[0].task.do[0].task.kind).toBe("set");
      }
    });

    it("discriminates for tasks with defaults (no each, no at)", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - loop:
      for:
        in: \${ $data.items }
      do:
        - step:
            set:
              x: 1
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("for");
      if (model.do[0].task.kind === "for") {
        expect(model.do[0].task.for.each).toBeUndefined();
        expect(model.do[0].task.for.in).toBe("${ $data.items }");
        expect(model.do[0].task.for.at).toBeUndefined();
        expect(model.do[0].task.while).toBeUndefined();
      }
    });

    it("parses golden 03-foreach-loop.yaml for task fields", () => {
      const model = loadWorkflowFromYaml(loadGolden("03-foreach-loop.yaml"));
      const forEntry = model.do.find((t) => t.task.kind === "for");
      expect(forEntry).toBeDefined();
      if (forEntry?.task.kind === "for") {
        expect(forEntry.task.for.each).toBe("item");
        expect(forEntry.task.for.in).toBe("${ $data.items }");
        expect(forEntry.task.do.length).toBeGreaterThan(0);
      }
    });

    it("parses golden 09-nested-states.yaml for task with context expression", () => {
      const model = loadWorkflowFromYaml(loadGolden("09-nested-states.yaml"));
      const forEntry = model.do.find((t) => t.task.kind === "for");
      expect(forEntry).toBeDefined();
      if (forEntry?.task.kind === "for") {
        expect(forEntry.task.for.each).toBe("item");
        expect(forEntry.task.for.in).toContain("$context");
        expect(forEntry.task.do.length).toBeGreaterThan(0);
      }
    });
  });

  describe("call:agent parsing", () => {
    it("parses call:agent with full config", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - triage:
      call: agent
      with:
        agent: "acme/support-triage"
        message: "Triage this ticket"
        env:
          API_KEY: "\${.secrets.KEY}"
        run_config:
          model_name: claude-3-5-sonnet
          max_cost_usd: 0.5
          max_tool_rounds: 15
          service_tier: fast
        output:
          schema:
            type: object
            required: [severity]
            properties:
              severity:
                type: string
                enum: [low, medium, high, critical]
          on_invalid: ON_INVALID_RETRY
          max_retries: 2
        harness: cursor
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("call:agent");
      if (task.kind === "call:agent") {
        expect(task.with.agent).toBe("acme/support-triage");
        expect(task.with.message).toBe("Triage this ticket");
        expect(task.with.env?.API_KEY).toBe("${.secrets.KEY}");
        expect(task.with.run_config?.model_name).toBe("claude-3-5-sonnet");
        expect(task.with.run_config?.max_cost_usd).toBe(0.5);
        expect(task.with.run_config?.max_tool_rounds).toBe(15);
        expect(task.with.run_config?.service_tier).toBe("SERVICE_TIER_FAST");
        expect(task.with.output?.schema.type).toBe("object");
        expect(task.with.output?.on_invalid).toBe("ON_INVALID_RETRY");
        expect(task.with.output?.max_retries).toBe(2);
        expect(task.with.harness).toBe("HARNESS_CURSOR");
      }
    });

    it("rejects unknown run_config keys with a named error", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        run_config:
          model: claude-sonnet-4-6
`;
      // "model" is the pre-#358 key; the shared RunConfig field is
      // "model_name". A typo'd knob must fail parsing, not silently no-op.
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "call:agent 'run_config' has unknown field 'model'",
      );
    });

    it("maps service_tier shorthands and canonical names to the enum name", () => {
      for (const [written, expected] of [
        ["standard", "SERVICE_TIER_STANDARD"],
        ["fast", "SERVICE_TIER_FAST"],
        ["FAST", "SERVICE_TIER_FAST"],
        ["SERVICE_TIER_STANDARD", "SERVICE_TIER_STANDARD"],
      ] as const) {
        const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        run_config:
          service_tier: "${written}"
`;
        const model = loadWorkflowFromYaml(yaml);
        const task = model.do[0].task;
        if (task.kind === "call:agent") {
          expect(task.with.run_config?.service_tier).toBe(expected);
        } else {
          throw new Error("expected call:agent task");
        }
      }
    });

    it("rejects an unknown service_tier value with a named error", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        run_config:
          service_tier: turbo
`;
      // The tier exists to make pricing deterministic — a typo must fail
      // parsing, never silently fall back to the default tier.
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "call:agent 'run_config.service_tier' has unknown value 'turbo'",
      );
    });

    it("rejects negative run_config bounds", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        run_config:
          max_cost_usd: -1
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "call:agent 'run_config.max_cost_usd' must be a number >= 0",
      );
    });

    it("parses git workspace entries", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        workspace_entries:
          - name: app
            source:
              git_repo:
                url: https://github.com/acme/app
                branch: main
          - source:
              git_repo:
                url: https://github.com/acme/lib
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("call:agent");
      if (task.kind === "call:agent") {
        const entries = task.with.workspace_entries;
        expect(entries).toHaveLength(2);
        expect(entries?.[0].name).toBe("app");
        expect(entries?.[0].source.git_repo.url).toBe("https://github.com/acme/app");
        expect(entries?.[0].source.git_repo.branch).toBe("main");
        expect(entries?.[1].name).toBeUndefined();
        expect(entries?.[1].source.git_repo.branch).toBeUndefined();
      }
    });

    it("rejects a workspace entry without a git url", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        workspace_entries:
          - source:
              local_path:
                path: /home/me/repo
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "call:agent 'workspace_entries[0]' requires 'source.git_repo.url'",
      );
    });

    it("rejects a non-list workspace_entries", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        workspace_entries: "https://github.com/acme/app"
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "call:agent 'workspace_entries' must be a list",
      );
    });

    it("rejects a non-mapping run_config", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        run_config: "cheap"
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "call:agent 'run_config' must be a mapping",
      );
    });

    it("normalizes harness shorthand 'native' to HARNESS_NATIVE", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: reviewer
        message: Review
        harness: native
`;
      const model = loadWorkflowFromYaml(yaml);
      if (model.do[0].task.kind === "call:agent") {
        expect(model.do[0].task.with.harness).toBe("HARNESS_NATIVE");
      }
    });

    it("throws when agent is missing", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        message: Hello
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("call:agent requires 'agent'");
    });

    it("throws when message is missing", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
      with:
        agent: my-agent
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("call:agent requires 'message'");
    });

    it("throws when with block is missing", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - invoke:
      call: agent
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("call:agent task requires a 'with' configuration block");
    });
  });

  describe("try/catch parsing", () => {
    it("parses a try/catch task with catch.as and catch.do", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: try-test
do:
  - tryCatch:
      try:
        - attempt:
            set:
              x: 1
      catch:
        as: error
        do:
          - recover:
              set:
                recovered: true
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do).toHaveLength(1);

      const task = model.do[0].task;
      expect(task.kind).toBe("try");
      if (task.kind === "try") {
        expect(task.try).toHaveLength(1);
        expect(task.try[0].key).toBe("attempt");
        expect(task.catch.as).toBe("error");
        expect(task.catch.do).toHaveLength(1);
        expect(task.catch.do![0].key).toBe("recover");
      }
    });

    it("parses catch.errors.with filter", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: filter-test
do:
  - tryCatch:
      try:
        - step:
            set:
              x: 1
      catch:
        errors:
          with:
            type: test/validation
            status: 400
        do:
          - handle:
              set:
                handled: true
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      if (task.kind === "try") {
        expect(task.catch.errors?.with).toEqual({ type: "test/validation", status: 400 });
      }
    });

    it("parses 08-error-retry.yaml (golden parity)", () => {
      const model = loadWorkflowFromYaml(loadGolden("08-error-retry.yaml"));
      expect(model.document.name).toBe("error-retry-test");
      expect(model.do).toHaveLength(1);

      const task = model.do[0].task;
      expect(task.kind).toBe("try");
      if (task.kind === "try") {
        expect(task.try).toHaveLength(1);
        expect(task.try[0].key).toBe("attemptCall");
        expect(task.catch.as).toBe("error");
        expect(task.catch.do).toHaveLength(1);
        expect(task.catch.do![0].key).toBe("errorHandler");
      }
    });

    it("parses 14-try-catch-raise.yaml", () => {
      const model = loadWorkflowFromYaml(loadGolden("14-try-catch-raise.yaml"));
      expect(model.document.name).toBe("try-catch-raise-test");
      expect(model.do).toHaveLength(5);

      expect(model.do[0].task.kind).toBe("set");
      expect(model.do[1].task.kind).toBe("try");
      expect(model.do[2].task.kind).toBe("try");
      expect(model.do[3].task.kind).toBe("try");
      expect(model.do[4].task.kind).toBe("set");

      const basicTry = model.do[1].task;
      if (basicTry.kind === "try") {
        expect(basicTry.try[0].task.kind).toBe("raise");
        expect(basicTry.catch.as).toBe("validationError");
      }

      const filteredTry = model.do[2].task;
      if (filteredTry.kind === "try") {
        expect(filteredTry.catch.errors?.with).toEqual({
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/timeout",
        });
      }

      const nestedTry = model.do[3].task;
      if (nestedTry.kind === "try") {
        expect(nestedTry.try).toHaveLength(3);
        expect(nestedTry.try[1].task.kind).toBe("try");
      }
    });
  });

  describe("catch.retry parsing", () => {
    it("parses retry with all fields", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: retry-full
do:
  - op:
      try:
        - step:
            set:
              x: 1
      catch:
        retry:
          when: \${ .error.status >= 500 }
          exceptWhen: \${ .error.type == "auth/expired" }
          delay:
            seconds: 2
          backoff:
            exponential: {}
          limit:
            attempt:
              count: 5
            duration:
              minutes: 2
          jitter:
            from:
              milliseconds: 100
            to:
              milliseconds: 500
        do:
          - fallback:
              set:
                failed: true
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("try");
      if (task.kind === "try") {
        const retry = task.catch.retry!;
        expect(retry.when).toBe("${ .error.status >= 500 }");
        expect(retry.exceptWhen).toBe('${ .error.type == "auth/expired" }');
        expect(retry.delay).toEqual({ seconds: 2 });
        expect(retry.backoff?.exponential).toEqual({});
        expect(retry.limit?.attempt?.count).toBe(5);
        expect(retry.limit?.duration).toEqual({ minutes: 2 });
        expect(retry.jitter?.from).toEqual({ milliseconds: 100 });
        expect(retry.jitter?.to).toEqual({ milliseconds: 500 });
      }
    });

    it("parses retry with partial fields (delay only)", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: retry-partial
do:
  - op:
      try:
        - step:
            set:
              x: 1
      catch:
        retry:
          delay:
            seconds: 1
          limit:
            attempt:
              count: 3
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      if (task.kind === "try") {
        const retry = task.catch.retry!;
        expect(retry.delay).toEqual({ seconds: 1 });
        expect(retry.limit?.attempt?.count).toBe(3);
        expect(retry.backoff).toBeUndefined();
        expect(retry.jitter).toBeUndefined();
        expect(retry.when).toBeUndefined();
        expect(retry.exceptWhen).toBeUndefined();
      }
    });

    it("parses retry with linear backoff", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: retry-linear
do:
  - op:
      try:
        - step:
            set:
              x: 1
      catch:
        retry:
          delay:
            seconds: 1
          backoff:
            linear: {}
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      if (task.kind === "try") {
        expect(task.catch.retry?.backoff?.linear).toEqual({});
        expect(task.catch.retry?.backoff?.exponential).toBeUndefined();
        expect(task.catch.retry?.backoff?.constant).toBeUndefined();
      }
    });

    it("rejects backoff with multiple strategies", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: retry-bad-backoff
do:
  - op:
      try:
        - step:
            set:
              x: 1
      catch:
        retry:
          backoff:
            exponential: {}
            linear: {}
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow(
        "Retry backoff must specify exactly one strategy",
      );
    });

    it("handles missing retry config gracefully", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: no-retry
do:
  - op:
      try:
        - step:
            set:
              x: 1
      catch:
        as: error
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      if (task.kind === "try") {
        expect(task.catch.retry).toBeUndefined();
      }
    });

    it("parses golden YAML #21 (retry-backoff)", () => {
      const model = loadWorkflowFromYaml(loadGolden("21-retry-backoff.yaml"));
      expect(model.document.name).toBe("retry-backoff-test");
      expect(model.do).toHaveLength(7);

      expect(model.do[0].task.kind).toBe("set");
      expect(model.do[1].task.kind).toBe("try");
      expect(model.do[2].task.kind).toBe("try");
      expect(model.do[3].task.kind).toBe("try");
      expect(model.do[4].task.kind).toBe("try");
      expect(model.do[5].task.kind).toBe("try");
      expect(model.do[6].task.kind).toBe("set");

      const fixedDelay = model.do[1].task;
      if (fixedDelay.kind === "try") {
        const retry = fixedDelay.catch.retry!;
        expect(retry.delay).toEqual({ seconds: 2 });
        expect(retry.limit?.attempt?.count).toBe(3);
        expect(retry.backoff).toBeUndefined();
      }

      const exponential = model.do[2].task;
      if (exponential.kind === "try") {
        const retry = exponential.catch.retry!;
        expect(retry.delay).toEqual({ seconds: 1 });
        expect(retry.backoff?.exponential).toEqual({});
        expect(retry.jitter?.from).toEqual({ milliseconds: 0 });
        expect(retry.jitter?.to).toEqual({ milliseconds: 200 });
        expect(retry.limit?.attempt?.count).toBe(4);
        expect(retry.limit?.duration).toEqual({ seconds: 30 });
      }

      const conditional = model.do[3].task;
      if (conditional.kind === "try") {
        const retry = conditional.catch.retry!;
        expect(retry.when).toBe("${ $error.status == 429 or $error.status == 503 }");
        expect(retry.backoff?.constant).toEqual({});
      }

      const exceptWhen = model.do[4].task;
      if (exceptWhen.kind === "try") {
        const retry = exceptWhen.catch.retry!;
        expect(retry.exceptWhen).toBe('${ $error.type == "auth/token-expired" }');
      }

      const linear = model.do[5].task;
      if (linear.kind === "try") {
        const retry = linear.catch.retry!;
        expect(retry.delay).toEqual({ milliseconds: 500 });
        expect(retry.backoff?.linear).toEqual({});
        expect(retry.limit?.attempt?.count).toBe(3);
      }
    });

    it("ignores non-positive-integer attempt count", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: retry-bad-count
do:
  - op:
      try:
        - step:
            set:
              x: 1
      catch:
        retry:
          limit:
            attempt:
              count: -1
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      if (task.kind === "try") {
        expect(task.catch.retry?.limit?.attempt).toBeUndefined();
      }
    });
  });

  describe("fork parsing", () => {
    it("parses fork with branches and compete flag", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: fork-test
do:
  - parallel:
      fork:
        compete: true
        branches:
          - fast:
              do:
                - s1:
                    set:
                      result: quick
          - slow:
              do:
                - s2:
                    set:
                      result: delayed
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("fork");
      if (task.kind === "fork") {
        expect(task.fork.compete).toBe(true);
        expect(task.fork.branches).toHaveLength(2);
        expect(task.fork.branches[0].key).toBe("fast");
        expect(task.fork.branches[1].key).toBe("slow");
      }
    });

    it("parses fork with nested do blocks in branches", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: fork-nested-test
do:
  - parallel:
      fork:
        branches:
          - branchA:
              do:
                - step1:
                    set:
                      a: 1
                - step2:
                    set:
                      b: 2
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("fork");
      if (task.kind === "fork") {
        expect(task.fork.compete).toBeUndefined();
        expect(task.fork.branches).toHaveLength(1);
        const branch = task.fork.branches[0];
        expect(branch.key).toBe("branchA");
        expect(branch.task.kind).toBe("do");
        if (branch.task.kind === "do") {
          expect(branch.task.do).toHaveLength(2);
        }
      }
    });

    it("parses golden 04 fork with complete branch structure", () => {
      const model = loadWorkflowFromYaml(loadGolden("04-parallel-concurrent.yaml"));
      const entry = model.do[0];
      expect(entry.key).toBe("runParallel");
      expect(entry.task.kind).toBe("fork");
      if (entry.task.kind === "fork") {
        expect(entry.task.fork.branches).toHaveLength(3);
        expect(entry.task.fork.branches[0].key).toBe("branch1");
        expect(entry.task.fork.branches[1].key).toBe("branch2");
        expect(entry.task.fork.branches[2].key).toBe("branch3");
        for (const branch of entry.task.fork.branches) {
          expect(branch.task.kind).toBe("do");
          if (branch.task.kind === "do") {
            expect(branch.task.do).toHaveLength(1);
            expect(branch.task.do[0].task.kind).toBe("call:http");
          }
        }
      }
    });

    it("parses 15-fork-parallel.yaml with non-compete, compete, and nested forks", () => {
      const model = loadWorkflowFromYaml(loadGolden("15-fork-parallel.yaml"));
      expect(model.document.name).toBe("fork-parallel-test");

      const forkTasks = model.do.filter((t) => t.task.kind === "fork");
      expect(forkTasks).toHaveLength(3);

      const nonCompete = forkTasks[0].task;
      if (nonCompete.kind === "fork") {
        expect(nonCompete.fork.branches).toHaveLength(3);
        expect(nonCompete.fork.compete).toBeUndefined();
      }

      const compete = forkTasks[1].task;
      if (compete.kind === "fork") {
        expect(compete.fork.compete).toBe(true);
        expect(compete.fork.branches).toHaveLength(2);
      }

      const nested = forkTasks[2].task;
      if (nested.kind === "fork") {
        expect(nested.fork.branches).toHaveLength(2);
        const leftBranch = nested.fork.branches[0];
        if (leftBranch.task.kind === "do") {
          const innerFork = leftBranch.task.do[0];
          expect(innerFork.task.kind).toBe("fork");
        }
      }
    });
  });

  describe("raise parsing", () => {
    it("parses a raise task with all fields", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: raise-test
do:
  - throwError:
      raise:
        error:
          type: custom/validation
          status: 400
          title: Validation Error
          detail: Field is required
          instance: exec-123
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("raise");
      if (task.kind === "raise") {
        expect(task.raise.error.type).toBe("custom/validation");
        expect(task.raise.error.status).toBe(400);
        expect(task.raise.error.title).toBe("Validation Error");
        expect(task.raise.error.detail).toBe("Field is required");
        expect(task.raise.error.instance).toBe("exec-123");
      }
    });

    it("throws when raise.error.type is missing", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: bad-raise
do:
  - throwError:
      raise:
        error:
          status: 500
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("requires 'error.type'");
    });

    it("throws when raise.error.status is missing", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: bad-raise
do:
  - throwError:
      raise:
        error:
          type: test/error
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("requires 'error.status'");
    });
  });

  describe("listen parsing", () => {
    it("parses a listen task with to.one", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: listen-test
do:
  - waitForSignal:
      listen:
        to:
          one:
            with:
              id: approval_signal
              type: signal
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("listen");
      if (task.kind === "listen") {
        expect(task.listen.to.one).toBeDefined();
        expect((task.listen.to.one!.with as any).id).toBe("approval_signal");
        expect((task.listen.to.one!.with as any).type).toBe("signal");
      }
    });

    it("parses a listen task with to.all (multiple events)", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: listen-all
do:
  - waitForAll:
      listen:
        to:
          all:
            - with:
                id: sig1
                type: signal
            - with:
                id: sig2
                type: signal
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("listen");
      if (task.kind === "listen") {
        expect(task.listen.to.all).toHaveLength(2);
      }
    });

    it("parses golden YAML #17 (listen-signal)", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  namespace: golden-tests
  name: listen-signal-test
  version: '1.0.0'
do:
  - waitForApproval:
      listen:
        to:
          one:
            with:
              id: approval_signal
              type: signal
  - processApproval:
      set:
        approved: true
  - waitForAllReviewers:
      listen:
        to:
          all:
            - with:
                id: reviewer_1_signal
                type: signal
            - with:
                id: reviewer_2_signal
                type: signal
  - allReviewsComplete:
      set:
        reviews_done: true
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do).toHaveLength(4);
      expect(model.do[0].task.kind).toBe("listen");
      expect(model.do[1].task.kind).toBe("set");
      expect(model.do[2].task.kind).toBe("listen");
      expect(model.do[3].task.kind).toBe("set");
    });
  });

  describe("wait parsing", () => {
    it("parses a wait task with seconds", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: wait-test
do:
  - delay:
      wait:
        seconds: 5
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("wait");
      if (task.kind === "wait") {
        expect(task.wait).toEqual({ seconds: 5 });
      }
    });

    it("parses a wait task with multiple duration fields", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: wait-multi
do:
  - longPause:
      wait:
        minutes: 2
        seconds: 30
        milliseconds: 500
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("wait");
      if (task.kind === "wait") {
        expect(task.wait).toEqual({ minutes: 2, seconds: 30, milliseconds: 500 });
      }
    });

    it("parses golden YAML #16 (wait-delay)", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  namespace: golden-tests
  name: wait-delay-test
  version: '1.0.0'
do:
  - setupData:
      set:
        started: true
  - shortDelay:
      wait:
        seconds: 5
  - markAfterShort:
      set:
        after_short: true
  - multiFieldDelay:
      wait:
        minutes: 1
        seconds: 30
  - markAfterMulti:
      set:
        after_multi: true
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do).toHaveLength(5);
      expect(model.do[1].task.kind).toBe("wait");
      expect(model.do[3].task.kind).toBe("wait");

      const shortDelay = model.do[1].task;
      if (shortDelay.kind === "wait") {
        expect(shortDelay.wait).toEqual({ seconds: 5 });
      }
      const multiDelay = model.do[3].task;
      if (multiDelay.kind === "wait") {
        expect(multiDelay.wait).toEqual({ minutes: 1, seconds: 30 });
      }
    });
  });

  describe("human_input task reclassification", () => {
    it("call: human_input with prompt is reclassified to kind human_input", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - askUser:
      call: human_input
      with:
        prompt: "Please approve this deployment"
`;
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do).toHaveLength(1);
      expect(model.do[0].key).toBe("askUser");
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.prompt).toBe("Please approve this deployment");
        expect(task.humanInput.outcomes).toBeUndefined();
        expect(task.humanInput.formSchema).toBeUndefined();
        expect(task.humanInput.approvers).toBeUndefined();
        expect(task.humanInput.timeout).toBeUndefined();
        expect(task.humanInput.onTimeout).toBeUndefined();
      }
    });

    it("call: human_input with outcomes array", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - approval:
      call: human_input
      with:
        prompt: "Approve or reject"
        outcomes:
          - name: approve
            label: Approve
            then: deployStep
          - name: reject
            label: Reject
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.outcomes).toHaveLength(2);
        expect(task.humanInput.outcomes![0]).toEqual({
          name: "approve",
          label: "Approve",
          then: "deployStep",
        });
        expect(task.humanInput.outcomes![1]).toEqual({
          name: "reject",
          label: "Reject",
          then: undefined,
        });
      }
    });

    it("call: human_input with form_schema", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - collectInfo:
      call: human_input
      with:
        prompt: "Fill out the form"
        form_schema:
          type: object
          required:
            - reason
          properties:
            reason:
              type: string
            priority:
              type: number
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.formSchema).toBeDefined();
        expect(task.humanInput.formSchema!.type).toBe("object");
        expect(task.humanInput.formSchema!.required).toEqual(["reason"]);
        expect(task.humanInput.formSchema!.properties).toEqual({
          reason: { type: "string" },
          priority: { type: "number" },
        });
      }
    });

    it("call: human_input with approvers", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - gatedApproval:
      call: human_input
      with:
        prompt: "Approve deployment"
        approvers:
          - alice@example.com
          - bob@example.com
          - 42
          - true
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.approvers).toEqual(["alice@example.com", "bob@example.com"]);
      }
    });

    it("call: human_input with timeout and on_timeout", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - timedApproval:
      call: human_input
      with:
        prompt: "Approve within time limit"
        timeout: 3600
        on_timeout: deny
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.timeout).toBe(3600);
        expect(task.humanInput.onTimeout).toBe("deny");
      }
    });

    // The server converter persists on_timeout as the proto enum NAME
    // (HumanInputTimeoutPolicy.String()), so every applied workflow carries
    // that form in its validated YAML. stigmer/stigmer#779: the loader used
    // to cast it unvalidated, and the orchestrator's switch silently treated
    // the unrecognized string as fail.
    const humanInputYamlWithOnTimeout = (onTimeout: string) => `
document:
  dsl: '1.0.0'
  name: test
do:
  - timedApproval:
      call: human_input
      with:
        prompt: "Approve within time limit"
        timeout: 3600
        on_timeout: ${onTimeout}
`;

    it("call: human_input normalizes proto enum-name on_timeout values to the internal policy words", () => {
      const cases = [
        ["HUMAN_INPUT_TIMEOUT_FAIL", "fail"],
        ["HUMAN_INPUT_TIMEOUT_APPROVE", "approve"],
        ["HUMAN_INPUT_TIMEOUT_DENY", "deny"],
      ] as const;
      for (const [wireForm, internalForm] of cases) {
        const model = loadWorkflowFromYaml(humanInputYamlWithOnTimeout(wireForm));
        const task = model.do[0].task;
        expect(task.kind).toBe("human_input");
        if (task.kind === "human_input") {
          expect(task.humanInput.onTimeout).toBe(internalForm);
        }
      }
    });

    it("call: human_input rejects the not-implemented escalate policy at load time", () => {
      for (const form of ["HUMAN_INPUT_TIMEOUT_ESCALATE", "escalate"]) {
        expect(() => loadWorkflowFromYaml(humanInputYamlWithOnTimeout(form)))
          .toThrow(/timedApproval.*escalate.*not implemented/);
      }
    });

    it("call: human_input rejects unknown on_timeout values instead of silently failing at timeout", () => {
      expect(() => loadWorkflowFromYaml(humanInputYamlWithOnTimeout("sometimes")))
        .toThrow(/timedApproval.*unknown on_timeout value 'sometimes'.*fail, approve, deny/);
    });

    it("call: human_input rejects non-string on_timeout values", () => {
      expect(() => loadWorkflowFromYaml(humanInputYamlWithOnTimeout("42")))
        .toThrow(/timedApproval.*on_timeout/);
    });

    it("call: human_input with payload and ui_hint", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - reviewGate:
      call: human_input
      with:
        prompt: "Review the proposal"
        payload: \${ $context.proposal }
        ui_hint: infra-proposal
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.payload).toBe("${ $context.proposal }");
        expect(task.humanInput.uiHint).toBe("infra-proposal");
      }
    });

    it("call: human_input with an inline object payload", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - reviewGate:
      call: human_input
      with:
        prompt: "Review the summary"
        payload:
          summary: "Severity: \${ $context.triage.severity }"
          static: true
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.payload).toEqual({
          summary: "Severity: ${ $context.triage.severity }",
          static: true,
        });
      }
    });

    it("call: human_input without payload/ui_hint leaves both undefined", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - plainGate:
      call: human_input
      with:
        prompt: "Just approve"
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.payload).toBeUndefined();
        expect(task.humanInput.uiHint).toBeUndefined();
      }
    });

    it("call: human_input drops a non-string or empty ui_hint", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - badHint:
      call: human_input
      with:
        prompt: "Approve"
        ui_hint: 42
  - emptyHint:
      call: human_input
      with:
        prompt: "Approve"
        ui_hint: ""
`;
      const model = loadWorkflowFromYaml(yaml);
      for (const entry of model.do) {
        expect(entry.task.kind).toBe("human_input");
        if (entry.task.kind === "human_input") {
          expect(entry.task.humanInput.uiHint).toBeUndefined();
        }
      }
    });

    it("call: human_input missing prompt throws", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - noPrompt:
      call: human_input
      with:
        timeout: 300
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("requires 'prompt'");
    });

    it("call: human_input missing with block throws", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - noWith:
      call: human_input
`;
      expect(() => loadWorkflowFromYaml(yaml)).toThrow("requires a 'with' configuration block");
    });

    it("call: human_input with empty outcomes array", () => {
      const yaml = `
document:
  dsl: '1.0.0'
  name: test
do:
  - emptyOutcomes:
      call: human_input
      with:
        prompt: "Choose an action"
        outcomes: []
`;
      const model = loadWorkflowFromYaml(yaml);
      const task = model.do[0].task;
      expect(task.kind).toBe("human_input");
      if (task.kind === "human_input") {
        expect(task.humanInput.outcomes).toBeUndefined();
      }
    });
  });
});

