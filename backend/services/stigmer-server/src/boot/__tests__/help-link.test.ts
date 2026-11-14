/**
 * Where a person asks for help, resolved at boot (help-link.ts).
 *
 * The answer `getServerInfo` announces comes from STIGMER_HELP_URL and
 * STIGMER_HELP_LABEL. Pinned here, as a pure function: the link with its
 * words, the default words, and every value that is dropped or replaced
 * with the warning that names the fix. A wrong address is never announced,
 * since every console renders it as a link. The wire is held by
 * domain/platform/__tests__/platform.test.ts and, on every target, by the
 * conformance suite's platform case.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HELP_LABEL, resolveHelpLink } from "../help-link.js";

describe("resolveHelpLink", () => {
  it("announces nothing, and says nothing, when neither setting is set", () => {
    expect(resolveHelpLink({ url: "", label: "" })).toEqual({ answer: undefined, warnings: [] });
  });

  it("announces the address with the operator's words", () => {
    expect(resolveHelpLink({ url: "https://help.acme.example/stigmer", label: "Ask IT on Slack" })).toEqual({
      answer: { url: "https://help.acme.example/stigmer", label: "Ask IT on Slack" },
      warnings: [],
    });
  });

  it("says 'Get help' when only the address is set", () => {
    expect(resolveHelpLink({ url: "https://help.acme.example", label: "" }).answer).toEqual({
      url: "https://help.acme.example",
      label: DEFAULT_HELP_LABEL,
    });
  });

  it("trims both settings before reading them", () => {
    expect(resolveHelpLink({ url: "  mailto:it@acme.example ", label: " Email IT " })).toEqual({
      answer: { url: "mailto:it@acme.example", label: "Email IT" },
      warnings: [],
    });
  });

  it.each([
    ["a javascript: address", "javascript:alert(1)"],
    ["a relative address", "/help"],
    ["a bare host", "help.acme.example"],
    ["a data: address", "data:text/html,hi"],
  ])("drops %s with a warning naming the fix, never serving it", (_name, url) => {
    const resolved = resolveHelpLink({ url, label: "Help" });
    expect(resolved.answer).toBeUndefined();
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain("STIGMER_HELP_URL is not an absolute https:, http: or mailto: address");
  });

  it("replaces a label over 40 characters with the default, and warns", () => {
    const resolved = resolveHelpLink({ url: "https://help.acme.example", label: "x".repeat(41) });
    expect(resolved.answer).toEqual({ url: "https://help.acme.example", label: DEFAULT_HELP_LABEL });
    expect(resolved.warnings[0]).toContain("longer than 40 characters");
  });

  it("keeps a label of exactly 40 characters", () => {
    const label = "y".repeat(40);
    expect(resolveHelpLink({ url: "https://help.acme.example", label })).toEqual({
      answer: { url: "https://help.acme.example", label },
      warnings: [],
    });
  });

  it("warns that a label with no address is unused", () => {
    const resolved = resolveHelpLink({ url: "", label: "Ask IT" });
    expect(resolved.answer).toBeUndefined();
    expect(resolved.warnings[0]).toContain("STIGMER_HELP_LABEL is set but STIGMER_HELP_URL is not");
  });
});
