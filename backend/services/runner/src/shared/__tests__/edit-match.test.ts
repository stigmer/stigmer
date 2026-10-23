/**
 * The loose-edit matcher as a table: each tier, line endings, kept bytes,
 * uniqueness, and the refusals that keep an ambiguous edit failing as today.
 *
 * Every resolved case is applied the way deepagents applies an edit
 * (`content.split(old).join(new)`, after its occurrence count), so a case
 * asserts the file the person ends up with, not the matcher's internals.
 */

import { describe, expect, it } from "vitest";
import { foldTypography, resolveEdit, type EditResolution } from "../edit-match.js";

/** deepagents' `performStringReplacement`, as the backend runs it on the resolved text. */
function applyAsDeepagents(content: string, resolution: EditResolution, replaceAll = false): string {
  if (resolution.kind !== "resolved") throw new Error(`expected a resolved edit, got ${resolution.kind}`);
  const occurrences = content.split(resolution.oldString).length - 1;
  expect(occurrences).toBeGreaterThan(0);
  if (!replaceAll) expect(occurrences).toBe(1);
  return content.split(resolution.oldString).join(resolution.newString);
}

describe("resolveEdit: today's path", () => {
  it("passes an exact quote through untouched", () => {
    expect(resolveEdit("const a = 1;\n", "a = 1", "a = 2", false)).toEqual({ kind: "exact" });
  });

  it("passes an exact quote that occurs twice through, so deepagents refuses it in its own words", () => {
    expect(resolveEdit("x\nx\n", "x", "y", false)).toEqual({ kind: "exact" });
  });

  it("never resolves an empty quote", () => {
    expect(resolveEdit("", "", "seed", false)).toEqual({ kind: "none" });
    expect(resolveEdit("text", "", "seed", false)).toEqual({ kind: "none" });
  });

  it("finds nothing when no tier matches", () => {
    expect(resolveEdit("const a = 1;\n", "const b = 1;", "const b = 2;", false)).toEqual({ kind: "none" });
  });

  it("never folds indentation", () => {
    expect(resolveEdit("\tcall();\n", "    call();", "    done();", false)).toEqual({ kind: "none" });
    expect(resolveEdit("  call();\n", "call();  \n", "done();\n", false)).toEqual({ kind: "none" });
  });
});

describe("resolveEdit: line endings", () => {
  it("lands a multi-line LF quote in a CRLF file and keeps the file CRLF", () => {
    const content = "one\r\ntwo\r\nthree\r\n";
    const resolution = resolveEdit(content, "one\ntwo\n", "one\n2\n", false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "line-endings", oldString: "one\r\ntwo\r\n" });
    expect(applyAsDeepagents(content, resolution)).toBe("one\r\n2\r\nthree\r\n");
  });

  it("gives an added line the region's dominant ending", () => {
    const content = "a\r\nb\r\nc\r\n";
    const resolution = resolveEdit(content, "a\nb\n", "a\nnew\nb\n", false);
    expect(applyAsDeepagents(content, resolution)).toBe("a\r\nnew\r\nb\r\nc\r\n");
  });

  it("keeps each line's own ending in a mixed file, a changed line taking the ending of the line it replaces", () => {
    const content = "keep\r\nchange\nlast\r\n";
    const resolution = resolveEdit(content, "keep\nchange\nlast\n", "keep\nchanged\nlast\n", false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "line-endings" });
    expect(applyAsDeepagents(content, resolution)).toBe("keep\r\nchanged\nlast\r\n");
  });

  it("falls back to the file's dominant ending when the region has no line ending of its own", () => {
    const content = "a\r\nb\r\nit’s";
    const resolution = resolveEdit(content, "it's", "it's\nmore", false);
    expect(applyAsDeepagents(content, resolution)).toBe("a\r\nb\r\nit’s\r\nmore");
  });

  it("lands a CRLF quote in an LF file without bringing the CRLF in", () => {
    const content = "one\ntwo\n";
    const resolution = resolveEdit(content, "one\r\ntwo\r\n", "one\r\n2\r\n", false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "line-endings" });
    expect(applyAsDeepagents(content, resolution)).toBe("one\n2\n");
  });
});

describe("resolveEdit: typographic folding", () => {
  it("lands a straight-quoted edit on curly quotes", () => {
    const content = "print(“hello”)\n";
    const resolution = resolveEdit(content, 'print("hello")', 'print("bye")', false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "typography", oldString: "print(“hello”)" });
    expect(applyAsDeepagents(content, resolution)).toBe('print("bye")\n');
  });

  it("keeps the curly quotes of a context line the model did not change", () => {
    const content = "// it’s the “main” loop\nconst limit = 1;\n";
    const resolution = resolveEdit(
      content,
      '// it\'s the "main" loop\nconst limit = 1;',
      '// it\'s the "main" loop\nconst limit = 2;',
      false,
    );
    expect(applyAsDeepagents(content, resolution)).toBe("// it’s the “main” loop\nconst limit = 2;\n");
  });

  it("folds dashes and non-breaking spaces one character to one", () => {
    expect(foldTypography("a—b c−d")).toBe("a-b c-d");
    const content = "range 1–2 pages\n";
    const resolution = resolveEdit(content, "range 1-2 pages", "range 1-3 pages", false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "typography", oldString: "range 1–2 pages" });
    expect(applyAsDeepagents(content, resolution)).toBe("range 1-3 pages\n");
  });

  it("folds on the LF view, so a curly quote in a CRLF file lands and the file stays CRLF", () => {
    const content = "say(“hi”)\r\nnext()\r\n";
    const resolution = resolveEdit(content, 'say("hi")\nnext()\n', 'say("hi")\nlater()\n', false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "typography" });
    expect(applyAsDeepagents(content, resolution)).toBe("say(“hi”)\r\nlater()\r\n");
  });
});

describe("resolveEdit: trailing whitespace", () => {
  it("lands a quote that dropped a line's trailing spaces, and keeps them on the kept line", () => {
    const content = "a = 1   \nb = 2\nc = 3\n";
    const resolution = resolveEdit(content, "a = 1\nb = 2", "a = 1\nb = 20", false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "trailing-whitespace", oldString: "a = 1   \nb = 2" });
    expect(applyAsDeepagents(content, resolution)).toBe("a = 1   \nb = 20\nc = 3\n");
  });

  it("matches through the last line's newline when the quote ends in one", () => {
    const content = "x()  \r\ny()\r\n";
    const resolution = resolveEdit(content, "x()\ny()\n", "x()\nz()\n", false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "trailing-whitespace", oldString: "x()  \r\ny()\r\n" });
    expect(applyAsDeepagents(content, resolution)).toBe("x()  \r\nz()\r\n");
  });

  it("does not match through a newline the file's last line lacks", () => {
    expect(resolveEdit("x()  \ny()", "x()\ny()\n", "x()\nz()\n", false)).toEqual({ kind: "none" });
  });

  it("applies a change the model made to trailing whitespace itself", () => {
    const content = "a = 1\t\nb = 2\n";
    const resolution = resolveEdit(content, "a = 1\nb = 2\n", "a = 1  \nb = 2\n", false);
    expect(applyAsDeepagents(content, resolution)).toBe("a = 1  \nb = 2\n");
  });
});

describe("resolveEdit: uniqueness", () => {
  it("refuses two loose matches in deepagents' own words", () => {
    const content = "say(“hi”)\nsay(“hi”)\n";
    expect(resolveEdit(content, 'say("hi")', 'say("bye")', false)).toEqual({
      kind: "ambiguous",
      error:
        "Error: String 'say(\"hi\")' has multiple occurrences (appears 2 times) in file. " +
        "Use replace_all=True to replace all instances, or provide a more specific string with surrounding context.",
    });
  });

  it("decides at the first tier with matches, ignoring the looser ones", () => {
    // Folding would find both calls; the LF view finds only the straight-quoted one, and wins.
    const content = 'say("hi")\r\nx\r\nsay(“hi”)\r\nx\r\n';
    const resolution = resolveEdit(content, 'say("hi")\nx', 'say("hi")\ny', false);
    expect(resolution).toMatchObject({ kind: "resolved", tier: "line-endings" });
    expect(applyAsDeepagents(content, resolution)).toBe('say("hi")\r\ny\r\nsay(“hi”)\r\nx\r\n');
  });

  it("replaces byte-identical loose matches together under replace_all", () => {
    const content = "say(“hi”)\nsay(“hi”)\n";
    const resolution = resolveEdit(content, 'say("hi")', 'say("bye")', true);
    expect(applyAsDeepagents(content, resolution, true)).toBe('say("bye")\nsay("bye")\n');
  });

  it("refuses replace_all over loose matches that differ in the file", () => {
    const resolution = resolveEdit("it’s\nit‘s\n", "it's", "it is", true);
    expect(resolution).toEqual({
      kind: "ambiguous",
      error:
        "Error: String 'it's' has multiple occurrences (2 loose matches that differ from each other) in file. " +
        "Quote the text exactly as the file has it, or provide a more specific string with surrounding context.",
    });
  });

  it("refuses a whole-line match whose bytes also sit inside another line", () => {
    const content = "foo\nbarfoo\n";
    const expected = {
      kind: "ambiguous",
      error:
        "Error: String 'foo ' has multiple occurrences (the file text it matches also appears where it was not quoted) in file. " +
        "Quote the text exactly as the file has it, or provide a more specific string with surrounding context.",
    };
    expect(resolveEdit(content, "foo ", "baz", false)).toEqual(expected);
    expect(resolveEdit(content, "foo ", "baz", true)).toEqual(expected);
  });
});
