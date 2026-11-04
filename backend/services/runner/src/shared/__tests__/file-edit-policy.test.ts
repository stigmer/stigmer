/**
 * The file-edit rules every engine's gate shares (`shared/file-edit-policy.ts`),
 * judged on their own.
 *
 * Why it matters: the Stigmer harness's gate and Claude's call these same functions, so
 * a rule here is each engine's at once; the Stigmer harness's gate tests reach them
 * through LangChain's middleware and Claude's through its gate, and this
 * file pins the rules without either. The cases are the ones that decide
 * whether a person's review can be skipped: what capture lets flow, what it
 * never does (the shell, an MCP tool, the outputs folder, a repository's own
 * `.git` directory, in every posture: git never stages it, and what is
 * written there decides what the runtime's next git command runs), and the
 * secret-like write block that holds whatever capture or review says.
 */

import { describe, expect, it, vi } from "vitest";

import {
  blockedSecretPath,
  captureFlows,
  fileEditFlow,
  isGitDirectoryPath,
  secretBlockMessage,
  type FileEditPosture,
} from "../file-edit-policy.js";

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

describe("a repository's own .git directory never flows (stigmer#2962)", () => {
  const gitPaths = ["/.git/config", ".git/hooks/pre-commit", "/sub/.git/config", "/.GIT/config", "/.git", "C:\\repo\\.git\\config"];

  it("is named by any .git segment, without case, and nothing else", () => {
    for (const path of gitPaths) expect(isGitDirectoryPath(path), path).toBe(true);
    for (const path of ["/.gitignore", "/.github/workflows/ci.yml", "/src/git/a.ts", "/x.git/a", "/.gitattributes"]) {
      expect(isGitDirectoryPath(path), path).toBe(false);
    }
  });

  it("is never captured, so a write or delete there asks, though git calls it capturable", async () => {
    const observed: FileEditPosture = { ...CAPTURE, captureIgnored: true, captureDeleteBefore: async () => {} };
    for (const path of gitPaths) {
      for (const category of ["write", "delete"] as const) {
        expect(await captureFlows(observed, { path }, "", category), `${category} ${path}`).toBe(false);
        expect(await fileEditFlow(observed, { path }, "", category), `${category} ${path}`).toBeUndefined();
      }
    }
  });

  it("asks for a path the engine resolves into .git through a link, even where ignored writes flow", async () => {
    const throughLink: FileEditPosture = {
      ...CAPTURE,
      captureIgnored: true,
      isCapturablePath: async () => false,
      inGitDirectory: async (path) => path === "/ln/config",
    };
    expect(await captureFlows(throughLink, { path: "/ln/config" }, "", "write")).toBe(false);
    expect(await fileEditFlow(throughLink, { path: "/ln/config" }, "", "write")).toBeUndefined();
    expect(await fileEditFlow({ fileReviewOff: true, inGitDirectory: async () => true }, { path: "/ln/config" }, "", "write")).toBeUndefined();
    expect(await captureFlows(throughLink, { path: "/build/out" }, "", "write"), "an ignored write elsewhere still flows").toBe(true);
  });

  it("asks even with file review off, where every other write flows", async () => {
    expect(await fileEditFlow({ fileReviewOff: true }, { path: "/.git/config" }, "", "write")).toBeUndefined();
    expect(await fileEditFlow({ fileReviewOff: true }, { path: "/.gitignore" }, "", "write")).toBe("file_review_off");
    expect(await fileEditFlow({ fileReviewOff: true, inGitDirectory: async () => true }, {}, "", "write"), "a call with no path is not judged by its path").toBe("file_review_off");
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
