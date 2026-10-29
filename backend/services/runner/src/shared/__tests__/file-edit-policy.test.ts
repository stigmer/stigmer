/**
 * The file-edit rules every engine's gate shares (`shared/file-edit-policy.ts`),
 * judged on their own.
 *
 * Why it matters: the Stigmer harness's gate and Claude's call these same functions, so
 * a rule here is each engine's at once; the Stigmer harness's gate tests reach them
 * through LangChain's middleware and Claude's through its gate, and this
 * file pins the rules without either. The cases are the ones that decide
 * whether a person's review can be skipped: what capture lets flow, what it
 * never does (the shell, an MCP tool, the outputs folder), and the
 * secret-like write block that holds whatever capture or review says.
 */

import { describe, expect, it, vi } from "vitest";

import { blockedSecretPath, captureFlows, fileEditFlow, secretBlockMessage, type FileEditPosture } from "../file-edit-policy.js";

const CAPTURE: FileEditPosture = { fileCaptureMode: true, fileCaptureSubstrate: true, captureIgnored: false, isCapturablePath: async () => true };

describe("captureFlows", () => {
  it("lets a built-in write or delete of a capturable path flow", async () => {
    expect(await captureFlows(CAPTURE, { path: "/src/a.ts" }, "", "write")).toBe(true);
    expect(await captureFlows(CAPTURE, { path: "/src/a.ts" }, "", "delete")).toBe(true);
  });

  it("never lets the shell, an MCP tool, or a path in the outputs folder flow", async () => {
    expect(await captureFlows(CAPTURE, { command: "rm -rf /" }, "", "shell")).toBe(false);
    expect(await captureFlows(CAPTURE, { path: "/src/a.ts" }, "docs", undefined)).toBe(false);
    expect(await captureFlows(CAPTURE, { path: "/.stigmer/outputs/r.md" }, "", "write")).toBe(false);
    expect(await captureFlows({ ...CAPTURE, fileCaptureMode: false }, { path: "/src/a.ts" }, "", "write")).toBe(false);
  });

  it("lets an ignored path flow only where the engine observes it, capturing a delete's bytes first", async () => {
    const ignored: FileEditPosture = { ...CAPTURE, isCapturablePath: async () => false };
    expect(await captureFlows(ignored, { path: "/build/a" }, "", "write")).toBe(false);
    const captureDeleteBefore = vi.fn(async () => {});
    const observed: FileEditPosture = { ...ignored, captureIgnored: true, captureDeleteBefore };
    expect(await captureFlows(observed, { path: "/build/a" }, "", "write")).toBe(true);
    expect(await captureFlows(observed, { path: "/build/a" }, "", "delete")).toBe(true);
    expect(captureDeleteBefore).toHaveBeenCalledWith("/build/a");
    expect(await captureFlows(observed, { path: "/.env" }, "", "delete"), "a secret-like delete stays on the gate").toBe(false);
  });
});

describe("fileEditFlow and the secret-like write block", () => {
  it("flows with review off and under capture, and blocks a secret-like write either way", async () => {
    expect(await fileEditFlow({ fileReviewOff: true }, { path: "/a.ts" }, "", "write")).toBe("file_review_off");
    expect(await fileEditFlow(CAPTURE, { path: "/a.ts" }, "", "write")).toBe("file_capture");
    expect(await fileEditFlow({ fileReviewOff: true }, { path: "/a.ts" }, "", "shell")).toBeUndefined();
    expect(await blockedSecretPath({ fileReviewOff: true }, { path: "/.env" }, "", "write")).toBe("/.env");
    expect(await blockedSecretPath(CAPTURE, { path: "/.env" }, "", "write"), "a capturable secret-like path is reviewed, not blocked").toBeUndefined();
    expect(secretBlockMessage("Write", "/.env")).toContain("'/.env'");
  });
});
