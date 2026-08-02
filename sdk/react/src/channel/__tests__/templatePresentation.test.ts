import { describe, it, expect } from "vitest";
import {
  splitTemplateBody,
  templateStatusPhase,
} from "../templatePresentation";

describe("templateStatusPhase", () => {
  // The documented five (DD-003) plus the observed extras (DD-005 D7:
  // Meta's live vocabulary exceeds the documented set).
  it.each([
    ["APPROVED", "ready"],
    ["PENDING", "pending"],
    ["IN_APPEAL", "pending"],
    ["PAUSED", "degraded"],
    ["LIMIT_EXCEEDED", "degraded"],
    ["REJECTED", "failed"],
    ["DISABLED", "failed"],
    ["PENDING_DELETION", "disabled"],
    ["DELETED", "disabled"],
  ] as const)("maps %s to %s", (status, phase) => {
    expect(templateStatusPhase(status)).toBe(phase);
  });

  it("lands unknown statuses on draft — Meta can add states this build predates", () => {
    expect(templateStatusPhase("SOME_FUTURE_STATE")).toBe("draft");
    expect(templateStatusPhase("")).toBe("draft");
  });

  it("is case-sensitive like the wire — Meta emits uppercase, anything else is unknown", () => {
    // The server relays Meta's verbatim uppercase strings; a lowercase
    // variant is not a known status and must not color as one.
    expect(templateStatusPhase("approved")).toBe("draft");
  });
});

describe("splitTemplateBody", () => {
  it("returns one text segment for a body without placeholders", () => {
    expect(splitTemplateBody("Your class is confirmed.")).toEqual([
      { kind: "text", value: "Your class is confirmed." },
    ]);
  });

  it("splits positional placeholders out of surrounding text", () => {
    expect(
      splitTemplateBody("Hi {{1}}, your fee of {{2}} is due {{3}}."),
    ).toEqual([
      { kind: "text", value: "Hi " },
      { kind: "placeholder", value: "{{1}}" },
      { kind: "text", value: ", your fee of " },
      { kind: "placeholder", value: "{{2}}" },
      { kind: "text", value: " is due " },
      { kind: "placeholder", value: "{{3}}" },
      { kind: "text", value: "." },
    ]);
  });

  it("recognizes named placeholders", () => {
    expect(splitTemplateBody("Hello {{customer_name}}!")).toEqual([
      { kind: "text", value: "Hello " },
      { kind: "placeholder", value: "{{customer_name}}" },
      { kind: "text", value: "!" },
    ]);
  });

  it("handles adjacent placeholders and placeholder-only bodies", () => {
    expect(splitTemplateBody("{{1}}{{2}}")).toEqual([
      { kind: "placeholder", value: "{{1}}" },
      { kind: "placeholder", value: "{{2}}" },
    ]);
  });

  it("treats single or unbalanced braces as literal text", () => {
    expect(splitTemplateBody("a {1} b {{unclosed")).toEqual([
      { kind: "text", value: "a {1} b {{unclosed" },
    ]);
  });

  it("returns no segments for an empty body", () => {
    expect(splitTemplateBody("")).toEqual([]);
  });

  it("never rewrites — segments concatenate back to the input verbatim", () => {
    const bodies = [
      "Hi {{1}}, {{2}} due {{3}}.",
      "  leading and trailing  ",
      "{{ spaced }} stays verbatim",
      "mixed {{name}} and {{1}}",
    ];
    for (const body of bodies) {
      const joined = splitTemplateBody(body)
        .map((s) => s.value)
        .join("");
      expect(joined).toBe(body);
    }
  });
});
