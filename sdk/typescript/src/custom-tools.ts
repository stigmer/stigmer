/**
 * The host app's own tools: a typed way to declare one for a conversation's
 * `customTools` (the session's `custom_tools`), so a backend declares the
 * same tool the chat kit does, with one name and one definition.
 *
 * It does no I/O and checks nothing beyond the types: the server holds every
 * rule (names, reserved names, schemas, limits) when the conversation is
 * created, and refuses a tool it cannot offer with the rule it breaks. A
 * call of the tool reaches the host as an `agent.custom_tool_use`, and the
 * host answers it with `SessionClient.answerCustomToolUse`.
 */

import type { JsonObject } from "@bufbuild/protobuf";

import type { CustomToolInput } from "./gen/session.js";

/** One of the host app's own tools, as the host writes it. */
export interface CustomToolDefinition<Schema extends JsonObject = JsonObject> {
  /** The name the agent calls it by: letters, digits, `_` and `-`, at most 64, not a built-in tool's. */
  readonly name: string;
  /** What the tool does and when to call it, for the agent. */
  readonly description: string;
  /** The JSON Schema the call's input must match: an object schema (`{ type: "object", ... }`). */
  readonly inputSchema: Schema & { readonly type: "object" };
}

/**
 * Declares one of the host app's own tools, for a conversation's
 * `customTools` when it is created.
 *
 * @example
 * ```ts
 * const registerService = defineCustomTool({
 *   name: "show_registration_form",
 *   description: "Open the service registration form beside the chat, prefilled.",
 *   inputSchema: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
 * });
 * await client.session.create({ name: "Register payments", org: "acme", customTools: [registerService] });
 * ```
 */
export function defineCustomTool<Schema extends JsonObject>(tool: CustomToolDefinition<Schema>): CustomToolInput {
  return { name: tool.name, description: tool.description, inputSchema: structuredClone(tool.inputSchema) };
}
