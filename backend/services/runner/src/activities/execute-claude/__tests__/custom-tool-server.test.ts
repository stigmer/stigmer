/**
 * Pins the server the Claude engine reaches the host app's tools through
 * (`turn.ts` `customToolServer`): each tool listed under its declared
 * description and schema, marked for the engine to list with its own
 * tools; a call answered with the host's text, an error as an error; and a
 * call the gate did not allow, or one the host never answered, refused.
 */

import { describe, expect, it } from "vitest";

import { CUSTOM_TOOL_SERVER } from "../../../shared/custom-tools.js";
import { NOT_ADMITTED_MESSAGE, ROOT_CALLER, type GateVerdict } from "../gate.js";
import { customToolServer } from "../turn.js";

const FORM = { name: "show_form", description: "Open the form.", inputSchema: { type: "object", properties: { service: { type: "string" } } } };

const allow: GateVerdict = { kind: "allow", source: undefined, caller: ROOT_CALLER, toolName: `mcp__${CUSTOM_TOOL_SERVER}__show_form`, args: {}, rewritten: false, hook: undefined, context: [] };

function server(verdicts: Record<string, GateVerdict>) {
  const answers = new Map([
    ["call_ok", { text: "registered", isError: false }],
    ["call_err", { text: "closed", isError: true }],
  ]);
  return customToolServer([FORM], { verdictOf: (id) => verdicts[id] }, answers);
}

const call = (toolUseId: string) => ({ server: CUSTOM_TOOL_SERVER, tool: FORM.name, args: {}, toolUseId });

describe("customToolServer", () => {
  it("lists each tool as declared, marked to be listed with the engine's own tools", () => {
    const listed = server({});
    expect(listed.name).toBe(CUSTOM_TOOL_SERVER);
    expect(listed.tools()).toEqual([{ ...FORM, _meta: { "anthropic/alwaysLoad": true } }]);
  });

  it("answers an allowed call with the host's text, an error as an error", async () => {
    const served = server({ call_ok: allow, call_err: allow });
    expect(await served.call(call("call_ok"))).toEqual({ content: [{ type: "text", text: "registered" }] });
    expect(await served.call(call("call_err"))).toEqual({ content: [{ type: "text", text: "closed" }], isError: true });
  });

  it("refuses a call the gate did not allow, or one the host never answered", async () => {
    const served = server({ call_none: allow });
    expect(await served.call(call("call_ok"))).toEqual({ content: [{ type: "text", text: NOT_ADMITTED_MESSAGE }], isError: true });
    expect(await served.call(call("call_none"))).toEqual({ content: [{ type: "text", text: NOT_ADMITTED_MESSAGE }], isError: true });
  });
});
