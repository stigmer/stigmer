// Unit arms for the session spec builder's host tools. What they pin:
// - a session spec carries custom_tools only when asked, each tool's name,
//   description and input schema as given, in order.
// Pure: no target.
// Domain: conformance support (sessions).
import { describe, expect, it } from "vitest";
import { makeSessionSpec } from "../sessions";

describe("makeSessionSpec and custom tools", () => {
  it("carries custom_tools only when the session declares them", () => {
    const inputSchema = { type: "object", properties: { service: { type: "string" } }, required: ["service"] };

    const spec = makeSessionSpec({
      customTools: [
        { name: "show_registration_form", description: "Open the app's registration form.", inputSchema },
        { name: "pick_date", description: "Ask the person for a date.", inputSchema: { type: "object" } },
      ],
    });

    expect(spec.customTools).toEqual([
      { name: "show_registration_form", description: "Open the app's registration form.", inputSchema },
      { name: "pick_date", description: "Ask the person for a date.", inputSchema: { type: "object" } },
    ]);
    expect(makeSessionSpec({}).customTools).toBeUndefined();
  });
});
