/**
 * The shared prompt glue (`shared/prompt-sections.ts`): the standing order
 * and the input-files lines, grouped and in order. What each harness renders AROUND these is pinned whole by
 * the two builders' prompt goldens (`execute-deep-agent/__tests__/
 * prompt-goldens.test.ts`, `execute-cursor/__tests__/prompt-goldens.test.ts`);
 * this file pins the glue's own contract, harness-free, and the outputs
 * folder's instruction, whose wording decides where an agent saves a file
 * the person asked for (stigmer#2661).
 */

import { describe, it, expect } from "vitest";
import {
  hasInputFiles,
  inputFileLines,
  outputsFolderInstruction,
  standingContextSections,
  visionPromptInfoOf,
  type InputFileGroups,
  type StandingSectionKind,
} from "../prompt-sections.js";
import type { ListedFile } from "../file-mount.js";
import { formatDeclaredPreferencesText } from "../declared-preferences.js";

describe("standingContextSections", () => {
  const ORDER: readonly StandingSectionKind[] = [
    "conversation-sender",
    "declared-preferences",
    "recalled-memories",
    "session-context",
    "previous-conversation",
  ];

  it("renders every present section in the one ruled order, whatever order the fields arrive in", () => {
    const sections = standingContextSections({
      contextBridge: "bridge",
      sessionContext: "session",
      recalledMemories: { facts: ["fact"] },
      declaredPreferences: { orgContext: "org" },
      senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
    });
    expect(sections.map((s) => s.kind)).toEqual(ORDER);
  });

  it("omits an absent section and keeps the relative order of the rest", () => {
    const sections = standingContextSections({ contextBridge: "bridge", senderIdentity: { value: "U1", kind: "slack_user_id" } });
    expect(sections.map((s) => s.kind)).toEqual(["conversation-sender", "previous-conversation"]);
  });

  it("renders nothing for an empty context", () => {
    expect(standingContextSections({})).toEqual([]);
  });

  it("carries each body from the fact's own module, unframed", () => {
    const [section] = standingContextSections({ declaredPreferences: { userContext: "Keep answers terse." } });
    expect(section?.body).toBe(formatDeclaredPreferencesText({ userContext: "Keep answers terse." }));
    expect(section?.body.startsWith("<")).toBe(false);
    expect(section?.body.startsWith("#")).toBe(false);
  });
});

describe("inputFileLines", () => {
  const file = (relativePath: string): ListedFile => ({
    filename: relativePath.split("/").pop()!,
    relativePath,
    sizeBytes: 1024,
  });
  const NONE: InputFileGroups = { message: [], conversation: [], references: [] };

  it("lists this message's Files first, then the conversation's other Files, then the eval references, each under its label", () => {
    const { entries } = inputFileLines(
      {
        references: [file(".stigmer/inputs/fixtures/a.json")],
        conversation: [file(".stigmer/uploads/q3/ledger.xlsx")],
        message: [file(".stigmer/uploads/photo.png"), file(".stigmer/uploads/spec.pdf")],
      },
      undefined,
    );
    expect(entries).toEqual([
      "Sent with this message:",
      "- `.stigmer/uploads/photo.png` (1024 bytes)",
      "- `.stigmer/uploads/spec.pdf` (1024 bytes)",
      "Shared earlier in this conversation:",
      "- `.stigmer/uploads/q3/ledger.xlsx` (1024 bytes)",
      "Reference files:",
      "- `.stigmer/inputs/fixtures/a.json` (1024 bytes)",
    ]);
  });

  it("leaves out a group that has no file, label and all", () => {
    expect(inputFileLines({ ...NONE, conversation: [file(".stigmer/uploads/a.txt")] }, undefined).entries).toEqual([
      "Shared earlier in this conversation:",
      "- `.stigmer/uploads/a.txt` (1024 bytes)",
    ]);
  });

  it("renders the vision lines only when the turn carries vision facts", () => {
    const groups = { ...NONE, message: [file(".stigmer/uploads/a.png")] };
    expect(inputFileLines(groups, undefined).vision).toEqual([]);
    const { vision } = inputFileLines(
      groups,
      { inlineFilenames: ["a.png"], notViewable: [{ path: ".stigmer/uploads/big.png", reason: "too_large" }] },
    );
    expect(vision.some((l) => l.includes("a.png"))).toBe(true);
    expect(vision.some((l) => l.includes("big.png"))).toBe(true);
  });
});

describe("hasInputFiles", () => {
  it("is true when any group has a file, and false when none does", () => {
    const one = { filename: "a", relativePath: ".stigmer/uploads/a", sizeBytes: 1 };
    expect(hasInputFiles({ message: [], conversation: [], references: [] })).toBe(false);
    expect(hasInputFiles({ message: [one], conversation: [], references: [] })).toBe(true);
    expect(hasInputFiles({ message: [], conversation: [one], references: [] })).toBe(true);
    expect(hasInputFiles({ message: [], conversation: [], references: [one] })).toBe(true);
  });
});

describe("visionPromptInfoOf", () => {
  it("is undefined when the turn has neither inline images nor degraded ones", () => {
    expect(visionPromptInfoOf({ visionImages: [], visionNotViewable: [] })).toBeUndefined();
  });

  it("names the inline images in send order and carries the degraded entries", () => {
    const info = visionPromptInfoOf({
      visionImages: [{ filename: "b.png" }, { filename: "a.jpg" }],
      visionNotViewable: [{ path: ".stigmer/uploads/big.png", reason: "too_large" }],
    });
    expect(info).toEqual({
      inlineFilenames: ["b.png", "a.jpg"],
      notViewable: [{ path: ".stigmer/uploads/big.png", reason: "too_large" }],
    });
  });
});

describe("outputsFolderInstruction", () => {
  it("opens with the rule for a file asked for at a path, so the folder never reads as that file's place", () => {
    const line = outputsFolderInstruction("/ws/.stigmer/outputs/");
    expect(line.startsWith("When the user asks for a file at a path, write it at that path in the workspace.")).toBe(true);
    expect(line).toContain("save it in `/ws/.stigmer/outputs/`");
    expect(line.indexOf("at that path in the workspace")).toBeLessThan(line.indexOf("/ws/.stigmer/outputs/"));
  });
});
