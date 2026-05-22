import { describe, it, expect, vi } from "vitest";
import { RunTaskBuilder } from "../../tasks/run.js";
import { createState } from "../../state.js";
import type { RunTaskDef, TaskExecutionContext, RunCommandConfig, RunWorkflowExecutionConfig } from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(overrides?: {
  runCommand?: (config: RunCommandConfig) => Promise<unknown>;
  runWorkflow?: (config: RunWorkflowExecutionConfig) => Promise<unknown>;
}): TaskExecutionContext {
  return {
    evaluateExpressions: async () => ({}),
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: notAvailable,
    listen: notAvailable,
    runCommand: overrides?.runCommand ?? notAvailable,
    runWorkflow: overrides?.runWorkflow ?? notAvailable,
    awaitHumanInput: notAvailable,
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

describe("RunTaskBuilder", () => {
  describe("validation", () => {
    it("throws when no mode is defined", () => {
      const taskDef: RunTaskDef = { kind: "run", run: {} };
      const builder = new RunTaskBuilder("task", taskDef);
      expect(() => builder.build()).toThrow("exactly one of 'script', 'shell', or 'workflow'");
    });

    it("throws when multiple modes are defined", () => {
      const taskDef: RunTaskDef = {
        kind: "run",
        run: {
          script: { language: "js", code: "1" },
          shell: { command: "echo" },
        },
      };
      const builder = new RunTaskBuilder("task", taskDef);
      expect(() => builder.build()).toThrow("only one of");
    });

    it("throws for unsupported script language", () => {
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { script: { language: "ruby", code: "puts 1" } },
      };
      const builder = new RunTaskBuilder("task", taskDef);
      expect(() => builder.build()).toThrow("unsupported script language 'ruby'");
    });

    it("throws when script.code is missing", () => {
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { script: { language: "js" } },
      };
      const builder = new RunTaskBuilder("task", taskDef);
      expect(() => builder.build()).toThrow("script.code is required");
    });

    it("throws when shell.command is missing", () => {
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { shell: { command: "" } },
      };
      const builder = new RunTaskBuilder("task", taskDef);
      expect(() => builder.build()).toThrow("shell.command is required");
    });

    it("throws when workflow.name is missing", () => {
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { workflow: { name: "", namespace: "default", version: "1.0.0" } },
      };
      const builder = new RunTaskBuilder("task", taskDef);
      expect(() => builder.build()).toThrow("workflow.name is required");
    });
  });

  describe("script execution", () => {
    it("calls ctx.runCommand with script config", async () => {
      const runCommand = vi.fn(async () => "hello world");
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { script: { language: "js", code: "console.log('hello world')" } },
      };

      const builder = new RunTaskBuilder("script1", taskDef);
      const executor = builder.build();
      const state = createState();
      const result = await executor(null, state, makeCtx({ runCommand }));

      expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
        mode: "script",
        language: "js",
        code: "console.log('hello world')",
      }));
      expect(result).toBe("hello world");
    });

    it("stores script result in state under task name", async () => {
      const runCommand = vi.fn(async () => "output-data");
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { script: { language: "python", code: "print('output-data')" } },
      };

      const builder = new RunTaskBuilder("pyScript", taskDef);
      const executor = builder.build();
      const state = createState();
      await executor(null, state, makeCtx({ runCommand }));

      expect(state.data.pyScript).toBe("output-data");
    });

    it("passes environment from script config", async () => {
      const runCommand = vi.fn(async () => "");
      const taskDef: RunTaskDef = {
        kind: "run",
        run: {
          script: {
            language: "js",
            code: "process.env.MY_VAR",
            environment: { MY_VAR: "value" },
          },
        },
      };

      const builder = new RunTaskBuilder("envScript", taskDef);
      const executor = builder.build();
      const state = createState();
      await executor(null, state, makeCtx({ runCommand }));

      expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
        environment: { MY_VAR: "value" },
      }));
    });
  });

  describe("shell execution", () => {
    it("calls ctx.runCommand with shell config", async () => {
      const runCommand = vi.fn(async () => "shell-output");
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { shell: { command: "echo hello" } },
      };

      const builder = new RunTaskBuilder("shell1", taskDef);
      const executor = builder.build();
      const state = createState();
      const result = await executor(null, state, makeCtx({ runCommand }));

      expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
        mode: "shell",
        command: "echo hello",
      }));
      expect(result).toBe("shell-output");
    });

    it("stores shell result in state", async () => {
      const runCommand = vi.fn(async () => "ls-result");
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { shell: { command: "ls" } },
      };

      const builder = new RunTaskBuilder("lsTask", taskDef);
      const executor = builder.build();
      const state = createState();
      await executor(null, state, makeCtx({ runCommand }));

      expect(state.data.lsTask).toBe("ls-result");
    });
  });

  describe("workflow execution", () => {
    it("calls ctx.runWorkflow with await: true", async () => {
      const runWorkflow = vi.fn(async () => ({ child: "done" }));
      const taskDef: RunTaskDef = {
        kind: "run",
        run: {
          workflow: { name: "child-workflow", namespace: "default", version: "1.0.0" },
        },
      };

      const builder = new RunTaskBuilder("childRun", taskDef);
      const executor = builder.build();
      const state = createState();
      const result = await executor(null, state, makeCtx({ runWorkflow }));

      expect(runWorkflow).toHaveBeenCalledWith({
        name: "child-workflow",
        input: undefined,
        await: true,
      });
      expect(result).toEqual({ child: "done" });
    });

    it("stores child workflow result in state", async () => {
      const runWorkflow = vi.fn(async () => ({ key: "value" }));
      const taskDef: RunTaskDef = {
        kind: "run",
        run: {
          workflow: { name: "sub-flow", namespace: "ns", version: "2.0.0" },
        },
      };

      const builder = new RunTaskBuilder("subflow", taskDef);
      const executor = builder.build();
      const state = createState();
      await executor(null, state, makeCtx({ runWorkflow }));

      expect(state.data.subflow).toEqual({ key: "value" });
    });

    it("passes workflow.input to child", async () => {
      const runWorkflow = vi.fn(async () => null);
      const taskDef: RunTaskDef = {
        kind: "run",
        run: {
          workflow: {
            name: "child",
            namespace: "default",
            version: "1.0.0",
            input: { userId: "u123" },
          },
        },
      };

      const builder = new RunTaskBuilder("task", taskDef);
      const executor = builder.build();
      await executor(null, createState(), makeCtx({ runWorkflow }));

      expect(runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        input: { userId: "u123" },
      }));
    });
  });

  describe("state.env propagation", () => {
    it("passes state.env as runtimeEnv to runCommand", async () => {
      const runCommand = vi.fn(async () => "");
      const taskDef: RunTaskDef = {
        kind: "run",
        run: { shell: { command: "test" } },
      };

      const builder = new RunTaskBuilder("envTask", taskDef);
      const executor = builder.build();
      const state = createState();
      state.env = { SECRET_KEY: "abc123" };
      await executor(null, state, makeCtx({ runCommand }));

      expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
        runtimeEnv: { SECRET_KEY: "abc123" },
      }));
    });
  });

  it("shouldRun always returns true", async () => {
    const taskDef: RunTaskDef = {
      kind: "run",
      run: { shell: { command: "echo" } },
    };
    const builder = new RunTaskBuilder("t", taskDef);
    expect(await builder.shouldRun()).toBe(true);
  });
});
