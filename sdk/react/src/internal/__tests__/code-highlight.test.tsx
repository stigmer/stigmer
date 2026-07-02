import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { resolveLanguage, highlightToReact } from "../code-highlight";

afterEach(cleanup);

describe("resolveLanguage", () => {
  it.each([
    ["a registered name", "go", "go"],
    ["uppercase is normalized", "GO", "go"],
    ["surrounding whitespace is trimmed", "  yaml  ", "yaml"],
    ["a registered alias (ts → typescript)", "ts", "ts"],
    ["a registered alias (tsx)", "tsx", "tsx"],
    ["a registered alias (html → xml)", "html", "html"],
    ["a registered alias (sh → bash)", "sh", "sh"],
  ])("resolves %s", (_label, input, expected) => {
    expect(resolveLanguage(input)).toBe(expected);
  });

  it.each([
    ["an unregistered language", "hcl"],
    ["a nonsense language", "klingon"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["undefined", undefined],
  ])("returns null for %s", (_label, input) => {
    expect(resolveLanguage(input)).toBeNull();
  });
});

describe("highlightToReact", () => {
  it("produces hljs token spans for a known language", () => {
    const node = highlightToReact("func main() {}", "go");
    expect(node).not.toBeNull();

    const { container } = render(<code>{node}</code>);
    // `func` is a Go keyword → at least one tokenized span must appear.
    expect(
      container.querySelectorAll('span[class*="hljs-"]').length,
    ).toBeGreaterThan(0);
  });

  it("highlights via an alias (ts)", () => {
    const node = highlightToReact("const x: number = 1;", "ts");
    expect(node).not.toBeNull();

    const { container } = render(<code>{node}</code>);
    expect(
      container.querySelectorAll('span[class*="hljs-"]').length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["an unregistered language", "hcl"],
    ["no language", undefined],
  ])("returns null for %s (caller falls back to flat)", (_label, language) => {
    expect(highlightToReact("anything at all", language)).toBeNull();
  });
});
