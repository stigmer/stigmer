/**
 * The shared prompt glue (`shared/prompt-sections.ts`): the standing order,
 * the input-files lines, the skill selection and the also-available sentence
 * (the sentence's arms came from `skill-writer.test.ts`, retired with its
 * module in #1096). What each harness renders AROUND these is pinned whole by
 * the two builders' prompt goldens (`execute-deep-agent/__tests__/
 * prompt-goldens.test.ts`, `execute-cursor/__tests__/prompt-goldens.test.ts`);
 * this file pins the glue's own contract, harness-free.
 */

import { describe, it, expect } from "vitest";
import {
  alsoAvailableSkillsNote,
  inputFileLines,
  selectSkillsForPrompt,
  standingContextSections,
  visionPromptInfoOf,
  type StandingSectionKind,
} from "../prompt-sections.js";
import type { ResolvedAttachment } from "../attachment-resolver.js";
import type { SkillMetadata } from "../skill-resolver.js";
import { SKILL_COUNT_THRESHOLD } from "../skill-relevance.js";
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
  const file = (relativePath: string, extra: Partial<ResolvedAttachment> = {}): ResolvedAttachment => ({
    filename: relativePath.split("/").pop()!,
    relativePath,
    sizeBytes: 1024,
    ...extra,
  });

  it("one bullet per file with the size, the rename disclosure and the download URL", () => {
    const { entries } = inputFileLines(
      [
        file(".stigmer/inputs/spec.pdf"),
        file(".stigmer/inputs/report-2.pdf", { renamedFrom: "report.pdf" }),
        file(".stigmer/inputs/diagram.png", { downloadUrl: "https://r2.example/d?sig=1" }),
      ],
      undefined,
      undefined,
    );
    expect(entries).toEqual([
      "- `.stigmer/inputs/spec.pdf` (1024 bytes)",
      "- `.stigmer/inputs/report-2.pdf` (1024 bytes) (renamed from duplicate 'report.pdf')",
      "- `.stigmer/inputs/diagram.png` (1024 bytes) — download URL: https://r2.example/d?sig=1",
    ]);
  });

  it("renders the URL hand-off line only when a listed file carries a URL AND the storage's kind is known", () => {
    const withUrl = [file("a.pdf", { downloadUrl: "https://r2.example/a" })];
    expect(inputFileLines(withUrl, undefined, "presigned").urlHandoff).toBeDefined();
    expect(inputFileLines(withUrl, undefined, undefined).urlHandoff).toBeUndefined();
    expect(inputFileLines([file("a.pdf")], undefined, "presigned").urlHandoff).toBeUndefined();
  });

  it("renders the vision lines only when the turn carries vision facts", () => {
    expect(inputFileLines([file("a.png")], undefined, undefined).vision).toEqual([]);
    const { vision } = inputFileLines(
      [file("a.png")],
      { inlineFilenames: ["a.png"], notViewable: [{ path: ".stigmer/inputs/big.png", reason: "too_large" }] },
      undefined,
    );
    expect(vision.some((l) => l.includes("a.png"))).toBe(true);
    expect(vision.some((l) => l.includes("big.png"))).toBe(true);
  });
});

describe("visionPromptInfoOf", () => {
  it("is undefined when the turn has neither inline images nor degraded ones", () => {
    expect(visionPromptInfoOf({ visionImages: [], visionNotViewable: [] })).toBeUndefined();
  });

  it("names the inline images in send order and carries the degraded entries", () => {
    const info = visionPromptInfoOf({
      visionImages: [{ filename: "b.png" }, { filename: "a.jpg" }],
      visionNotViewable: [{ path: ".stigmer/inputs/big.png", reason: "too_large" }],
    });
    expect(info).toEqual({
      inlineFilenames: ["b.png", "a.jpg"],
      notViewable: [{ path: ".stigmer/inputs/big.png", reason: "too_large" }],
    });
  });
});

describe("selectSkillsForPrompt", () => {
  const skill = (name: string, description: string): SkillMetadata => ({ name, description, path: `.stigmer/skills/${name}/SKILL.md` });

  it("highlights every skill below the threshold, in mount order, and names none as also-available", () => {
    const skills = [skill("alpha", "Deploy to kubernetes"), skill("beta", "Reshape CSV exports")];
    const selection = selectSkillsForPrompt("deploy the service", skills);
    expect(selection.highlighted).toEqual(skills);
    expect(selection.alsoAvailable).toEqual([]);
  });

  it("at the threshold, highlights the skills the message reaches and names the rest", () => {
    const skills = Array.from({ length: SKILL_COUNT_THRESHOLD }, (_, i) =>
      i === 0 ? skill("k8s-deploy", "Deploy services to kubernetes clusters") : skill(`other-${i}`, `Unrelated thing number ${i}`),
    );
    const selection = selectSkillsForPrompt("Deploy the payments service to kubernetes", skills);
    expect(selection.highlighted.map((s) => s.name)).toContain("k8s-deploy");
    expect(selection.alsoAvailable.length).toBeGreaterThan(0);
    expect(selection.highlighted.length + selection.alsoAvailable.length).toBe(SKILL_COUNT_THRESHOLD);
  });

  it("selects nothing from nothing", () => {
    expect(selectSkillsForPrompt("anything", [])).toEqual({ highlighted: [], alsoAvailable: [] });
  });
});

describe("alsoAvailableSkillsNote", () => {
  it("returns empty for no excluded names", () => {
    expect(alsoAvailableSkillsNote([])).toBe("");
  });

  it("lists excluded skills with backtick formatting", () => {
    const note = alsoAvailableSkillsNote(["alpha", "beta", "gamma"]);
    expect(note).toContain("`alpha`");
    expect(note).toContain("`beta`");
    expect(note).toContain("`gamma`");
  });

  it("includes activation instructions that name no tool, so any harness can carry it", () => {
    const note = alsoAvailableSkillsNote(["some-skill"]);
    expect(note).toContain(".stigmer/skills/<name>/SKILL.md");
    expect(note).toContain("relevant to your task");
    expect(note).not.toMatch(/\b(read|Read) tool\b/);
    expect(note.startsWith("#")).toBe(false);
  });
});
