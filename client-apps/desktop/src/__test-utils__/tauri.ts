// ---------------------------------------------------------------------------
// The Tauri IPC mock every desktop test uses
//
// Tests run the app's real modules, with their real `invoke` and `listen`
// imports, over Tauri's own IPC mock (`@tauri-apps/api/mocks`): a command the
// code sends reaches a handler the test names, by the command's wire name,
// and an event the test emits reaches the app's listeners. A command the test
// did not expect fails the call loudly, the way an unmocked fetch fails in
// the setup file, instead of answering `undefined`.
//
// `APP_COMMANDS` is the app's own command set, as src-tauri/src/lib.rs
// registers it; `__tests__/tauri.test.ts` fails when the two drift apart.
// Plugin commands travel as `plugin:<name>|<command>` (for example
// `plugin:updater|check`).
// ---------------------------------------------------------------------------

import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

export const APP_COMMANDS = [
  "open_auth_in_browser",
  "cancel_auth",
  "start_auth_callback_server",
  "start_github_callback_server",
  "start_runner",
  "stop_runner",
  "kill_runner",
  "add_session",
  "remove_session",
  "add_workflow_execution",
  "remove_workflow_execution",
  "update_runner_token",
  "runner_status",
  "bundled_node_path",
  "list_workspace_files",
  "read_workspace_file",
  "search_workspace_content",
] as const;

export type AppCommand = (typeof APP_COMMANDS)[number];
export type PluginCommand = `plugin:${string}|${string}`;
export type TauriCommand = AppCommand | PluginCommand;

export type CommandArgs = Record<string, unknown>;
export type CommandHandler = (args: CommandArgs) => unknown;
export type CommandHandlers = Partial<Record<TauriCommand, CommandHandler>>;

export interface TauriCall {
  readonly cmd: string;
  readonly args: CommandArgs;
}

export interface TauriMock {
  /** Every command the code sent, in order (event plumbing excluded). */
  readonly calls: TauriCall[];
  /** The arguments of every call to one command, in order. */
  callsTo(cmd: TauriCommand): CommandArgs[];
  /** Replace or add handlers mid-test. */
  handle(handlers: CommandHandlers): void;
  /** Emit an app event, as the Rust side would, to the app's listeners. */
  emit(event: string, payload?: unknown): Promise<void>;
}

/**
 * Install the IPC mock for one test. The setup file drops it after each
 * test (`clearMocks`), so every test starts with no handlers at all.
 */
export function mockTauri(handlers: CommandHandlers = {}): TauriMock {
  clearMocks();
  const table: CommandHandlers = { ...handlers };
  const calls: TauriCall[] = [];

  mockWindows("main");
  mockIPC(
    (cmd, payload) => {
      const args = (payload ?? {}) as CommandArgs;
      calls.push({ cmd, args });
      const handler = table[cmd as TauriCommand];
      if (!handler) {
        throw new Error(
          `Unmocked Tauri command in test: ${cmd}. Give mockTauri a handler for it.`,
        );
      }
      return handler(args);
    },
    { shouldMockEvents: true },
  );

  return {
    calls,
    callsTo: (cmd) =>
      calls.filter((call) => call.cmd === cmd).map((call) => call.args),
    handle: (more) => Object.assign(table, more),
    emit: (event, payload) => emit(event, payload),
  };
}
