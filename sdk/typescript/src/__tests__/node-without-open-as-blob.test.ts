// uploadFileFromPath on a Node without fs.openAsBlob (Node 18, which the
// package still admits): it refuses with the version it needs, before any
// request leaves. The module is loaded with node:fs as such a Node has it.
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, openAsBlob: undefined };
});

import type { RoutedFileClient } from "../file.js";
import { uploadFileFromPath } from "../node.js";

describe("uploadFileFromPath without fs.openAsBlob", () => {
  it("refuses, naming the Node it needs, and sends nothing", async () => {
    const files = {
      uploadFile: () => Promise.reject(new Error("nothing should be sent")),
    } as unknown as RoutedFileClient;
    await expect(uploadFileFromPath(files, { org: "acme", path: "/tmp/any.bin" })).rejects.toThrow(
      "uploadFileFromPath needs fs.openAsBlob (Node 19.8 or later)",
    );
  });
});
