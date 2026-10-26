// Types for claude-engine-pin.mjs, which the runner's tests import.
export declare const ENGINE_PIN_FILE: "claude-engine.json";
export declare const CLAUDE_SDK: "@anthropic-ai/claude-agent-sdk";
export interface ClaudeEnginePinFile {
  readonly version: string;
  readonly packages: Readonly<Record<string, { readonly resolved: string; readonly integrity: string }>>;
}
export declare function claudeEnginePin(lock: unknown): ClaudeEnginePinFile;
export declare function claudeEnginePinFromLockfile(path: string): ClaudeEnginePinFile;
