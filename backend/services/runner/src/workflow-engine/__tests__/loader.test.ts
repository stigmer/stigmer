import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowFromYaml } from "../loader.js";

const GOLDEN_DIR = join(
  import.meta.dirname,
  "../../../../workflow-runner/test/golden",
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

    it("discriminates custom call:function tasks", () => {
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
      const model = loadWorkflowFromYaml(yaml);
      expect(model.do[0].task.kind).toBe("call:function");
      if (model.do[0].task.kind === "call:function") {
        expect(model.do[0].task.call).toBe("agent");
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
  });
});
