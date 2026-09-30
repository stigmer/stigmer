// ---------------------------------------------------------------------------
// The IPC mock itself: it speaks the app's real command set, and it refuses
// what a test did not expect
//
// The command list in ../tauri.ts is hand-kept, so this suite reads the list
// the Rust host actually registers (`generate_handler!` in
// src-tauri/src/lib.rs) and fails when a command is added, renamed or
// removed on one side only. It also pins the mock's two promises: a handled
// command answers through the app's real `invoke`, and an unhandled one
// rejects instead of answering undefined.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { APP_COMMANDS, mockTauri } from "../tauri";

// Vitest runs with cwd at client-apps/desktop.
const LIB_RS = resolve(process.cwd(), "src-tauri", "src", "lib.rs");

function registeredCommands(): string[] {
  const source = readFileSync(LIB_RS, "utf8");
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  if (!block?.[1])
    throw new Error(`No generate_handler! list found in ${LIB_RS}`);
  return block[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.split("::").at(-1) ?? entry);
}

describe("the Tauri IPC mock", () => {
  it("knows exactly the commands the Rust host registers", () => {
    expect([...APP_COMMANDS].sort()).toEqual(registeredCommands().sort());
  });

  it("answers a handled command through the app's real invoke and records the call", async () => {
    const tauri = mockTauri({ bundled_node_path: () => "/abs/node" });

    await expect(invoke("bundled_node_path")).resolves.toBe("/abs/node");
    expect(tauri.calls).toEqual([{ cmd: "bundled_node_path", args: {} }]);
  });

  it("rejects a command the test gave no handler for", async () => {
    mockTauri();
    await expect(invoke("stop_runner")).rejects.toThrow(
      "Unmocked Tauri command in test: stop_runner",
    );
  });

  it("delivers an emitted event to the app's listeners", async () => {
    const tauri = mockTauri();
    const heard = vi.fn();
    await listen("auth-cancelled", (event) => heard(event.payload));

    await tauri.emit("auth-cancelled", { reason: "user" });
    expect(heard).toHaveBeenCalledWith({ reason: "user" });
  });
});
