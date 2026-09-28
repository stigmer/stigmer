/**
 * The names the native engine binds for its built-in tools, the one home
 * every text of this harness quotes them from.
 *
 * The model can call only what is bound, so a prompt that names a tool by
 * any other spelling sends it looking for something that does not exist.
 * That drift is not hypothetical: this harness's prompts named `read`,
 * `search` and `list_dir` after every rename upstream made, because each
 * text spelled the names itself. The prompt modules
 * (`prompt-builder.ts`, `subagent-transformer.ts`, `todo-list.ts`) now
 * interpolate these constants, and
 * `__tests__/engine-tools.test.ts` binds a real graph and fails when a name
 * here is not on its surface.
 *
 * The file tools, `execute` and `task` are deepagents' (1.14: the
 * filesystem and sub-agent middleware); `write_todos` is langchain's
 * `todoListMiddleware`, which this harness installs on the parent
 * (`turn-setup.ts`). The runner's own tools (`think`, `web_fetch`) carry
 * their names in `tools/`.
 */
export const ENGINE_TOOL = {
  ls: "ls",
  readFile: "read_file",
  writeFile: "write_file",
  editFile: "edit_file",
  glob: "glob",
  grep: "grep",
  execute: "execute",
  task: "task",
  writeTodos: "write_todos",
} as const;

export type EngineToolName = (typeof ENGINE_TOOL)[keyof typeof ENGINE_TOOL];
