/**
 * Run task builder — executes inline scripts, shell commands, or child workflows.
 *
 * Three execution modes:
 * - `run.script`: Inline JS/Python executed via activity (temp file + child_process)
 * - `run.shell`: Shell command executed via activity (child_process.exec)
 * - `run.workflow`: Child Temporal workflow (await or fire-and-forget)
 *
 * The kernel validates configuration and delegates to `ctx.runCommand`
 * (for script/shell) or `ctx.runWorkflow` (for child workflows).
 *
 * YAML shapes:
 *   - runScript:
 *       run:
 *         script:
 *           language: js
 *           code: "console.log('hello')"
 *
 *   - runShell:
 *       run:
 *         shell:
 *           command: echo
 *           arguments: { msg: "hello" }
 *
 *   - runChild:
 *       run:
 *         workflow:
 *           name: child-workflow
 *           namespace: default
 *           version: '1.0.0'
 */

import type {
  TaskBuilder,
  TaskDef,
  TaskExecutorFn,
  RunTaskDef,
  RunConfig,
  WorkflowState,
  TaskExecutionContext,
} from "../types.js";

const SUPPORTED_LANGUAGES = ["js", "python"];

export class RunTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;

  constructor(taskName: string, taskDef: RunTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    const runDef = this.taskDef as RunTaskDef;
    const config = runDef.run;
    const taskName = this.taskName;

    validateRunConfig(config, taskName);

    return async (_input: unknown, state: WorkflowState, ctx: TaskExecutionContext) => {
      let result: unknown;

      if (config.script) {
        result = await ctx.runCommand({
          mode: "script",
          language: config.script.language,
          code: config.script.code,
          arguments: config.script.arguments,
          environment: config.script.environment,
          runtimeEnv: state.env as Record<string, unknown>,
        });
      } else if (config.shell) {
        result = await ctx.runCommand({
          mode: "shell",
          command: config.shell.command,
          arguments: config.shell.arguments,
          environment: config.shell.environment,
          runtimeEnv: state.env as Record<string, unknown>,
        });
      } else if (config.workflow) {
        result = await ctx.runWorkflow({
          name: config.workflow.name,
          input: config.workflow.input,
          await: true,
        });
      }

      if (result !== undefined) {
        state.addData({ [taskName]: result });
      }

      return result;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}

function validateRunConfig(config: RunConfig, taskName: string): void {
  const modes = [config.script, config.shell, config.workflow].filter(Boolean);

  if (modes.length === 0) {
    throw new Error(
      `Run task '${taskName}': exactly one of 'script', 'shell', or 'workflow' must be defined`,
    );
  }
  if (modes.length > 1) {
    throw new Error(
      `Run task '${taskName}': only one of 'script', 'shell', or 'workflow' may be defined`,
    );
  }

  if (config.script) {
    if (!config.script.language) {
      throw new Error(`Run task '${taskName}': script.language is required`);
    }
    if (!SUPPORTED_LANGUAGES.includes(config.script.language)) {
      throw new Error(
        `Run task '${taskName}': unsupported script language '${config.script.language}'. ` +
        `Supported: ${SUPPORTED_LANGUAGES.join(", ")}`,
      );
    }
    if (!config.script.code) {
      throw new Error(`Run task '${taskName}': script.code is required`);
    }
  }

  if (config.shell) {
    if (!config.shell.command) {
      throw new Error(`Run task '${taskName}': shell.command is required`);
    }
  }

  if (config.workflow) {
    if (!config.workflow.name) {
      throw new Error(`Run task '${taskName}': workflow.name is required`);
    }
  }
}
