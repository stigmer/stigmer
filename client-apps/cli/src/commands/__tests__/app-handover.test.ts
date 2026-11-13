// `stigmer app-handover` (commands/app-handover.ts): the stack words it
// takes, the address a browser reaches a backend at, and the handover
// printed or written. The code itself is `buildAppHandover`'s, the console's
// In your app tab's one writer, so these tests hold what the command adds:
// the development chat alone on a server that trusts every caller, the files
// at the handover's own paths, and no file overwritten without `--force`.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAppHandover } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { CliExitError, UsageError } from "../../errors/index.js";
import { browserBaseUrl, parseStack, printedHandover, writeHandover } from "../app-handover.js";

const signIn = buildAppHandover({ mode: "sign-in", stack: "nextjs", baseUrl: "https://api.stigmer.ai", org: "acme", agent: "invoice-matcher" });
const local = buildAppHandover({ mode: "local", stack: "nextjs", baseUrl: "http://localhost:7234", org: "stigmer", agent: "invoice-matcher" });

describe("parseStack", () => {
  it.each([["nextjs", "nextjs"], ["Next.js", "nextjs"], ["next", "nextjs"], ["PYTHON", "python"], ["go", "go"]])("%s -> %s", (word, stack) => {
    expect(parseStack(word)).toBe(stack);
  });
  it("refuses a stack it has no route for, naming the ones it has", () => {
    expect(() => parseStack("rails")).toThrow(UsageError);
    expect(() => parseStack("rails")).toThrow(/nextjs, node, python, go, java/);
  });
});

describe("browserBaseUrl", () => {
  it.each([
    ["api.stigmer.ai:443", "https://api.stigmer.ai"],
    ["stigmer.example.com:7234", "http://stigmer.example.com:7234"],
    ["localhost:7234", "http://localhost:7234"],
    ["127.0.0.1:7234", "http://127.0.0.1:7234"],
    ["https://api.stigmer.ai/", "https://api.stigmer.ai"],
    ["stigmer.example.com", "https://stigmer.example.com"],
  ])("%s -> %s", (endpoint, url) => {
    expect(browserBaseUrl(endpoint)).toBe(url);
  });
});

describe("printedHandover", () => {
  it("prints each file under its path with what to install", () => {
    const text = printedHandover(signIn, "sign-in");
    expect(text).toContain(`# ${signIn.backend!.file}`);
    expect(text).toContain(`# ${signIn.chat.file}`);
    expect(text).toContain(signIn.backend!.code.trimEnd());
  });
  it("says the local handover is the development chat, with no route", () => {
    const text = printedHandover(local, "local");
    expect(text.startsWith("This server trusts every caller, so this is the development chat")).toBe(true);
    expect(text).not.toContain("stigmer-token");
  });
});

describe("writeHandover", () => {
  it("writes the route and the chat at the handover's paths", () => {
    const root = mkdtempSync(join(tmpdir(), "stigmer-handover-"));
    const result = writeHandover(signIn, "sign-in", root, false);
    expect(readFileSync(join(root, signIn.backend!.file), "utf8")).toBe(signIn.backend!.code);
    expect(readFileSync(join(root, signIn.chat.file), "utf8")).toBe(signIn.chat.code);
    expect(result.hints).toContain("Replace currentUser in the route with your app's own sign-in.");
  });
  it("writes only the chat on a server that trusts every caller", () => {
    const root = mkdtempSync(join(tmpdir(), "stigmer-handover-"));
    writeHandover(local, "local", root, false);
    expect(existsSync(join(root, local.chat.file))).toBe(true);
    expect(existsSync(join(root, "app", "api"))).toBe(false);
  });
  it("refuses to overwrite a file already there, and overwrites with force", () => {
    const root = mkdtempSync(join(tmpdir(), "stigmer-handover-"));
    writeHandover(signIn, "sign-in", root, false);
    writeFileSync(join(root, signIn.chat.file), "the builder's edit\n");
    expect(() => writeHandover(signIn, "sign-in", root, false)).toThrow(CliExitError);
    expect(readFileSync(join(root, signIn.chat.file), "utf8")).toBe("the builder's edit\n");
    writeHandover(signIn, "sign-in", root, true);
    expect(readFileSync(join(root, signIn.chat.file), "utf8")).toBe(signIn.chat.code);
  });
});
