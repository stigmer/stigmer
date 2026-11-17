/**
 * The code the console hands a builder to put an agent's chat in their own
 * app, compiled as the docs' own examples are.
 *
 * One function writes it (`buildAppHandover`, `sdk/typescript/src/app-handover.ts`):
 * a token route for each backend the console offers and the chat for their
 * React app, for a server that signs people in and for one that trusts every
 * caller, and a page that tries the chat. No fence holds that code, so the
 * gate writes it here: every stack's route at an https address and at a
 * plaintext one (Go, Python and Java take a different option for each), the
 * chat in both modes, and each distinct page beside the chat it imports, at
 * their paths in the builder's project (a Next.js page imports it through the
 * app's `@/` alias). Each is a unit of its own, a whole file in its own
 * language, compiled with the gate's compilers and reported against the
 * writer, so a change to the writer or to an SDK that breaks what a builder
 * copies fails the gate.
 *
 * The gate is plain Node, so it loads the writer as the client's build emits
 * it (`sdk/typescript/dist/app-handover.js`, made by `npm run build:libs`,
 * which every caller of the gate runs first). A tree without the writer (a
 * branch from before it) has no such units.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { pageLines } from "./collect.mjs";

/** The writer, from the repository root; the units are reported against it. */
export const HANDOVER_FILE = "sdk/typescript/src/app-handover.ts";

/** The writer as the client's build emits it, from the repository root. */
export const HANDOVER_BUILT = "sdk/typescript/dist/app-handover.js";

/** The addresses each route is written for: TLS, and plaintext (a server on a laptop). */
export const HANDOVER_ADDRESSES = ["https://api.stigmer.ai", "http://localhost:7234"];

/** The gate's language and the fence word for each language the writer emits. */
const LANGUAGES = {
  typescript: { language: "typescript", lang: "ts" },
  tsx: { language: "typescript", lang: "tsx" },
  python: { language: "python", lang: "python" },
  go: { language: "go", lang: "go" },
  java: { language: "java", lang: "java" },
};

/**
 * Every handed-over file as a whole-file unit, numbered from `firstId`.
 * @param {(input: object) => {backend?: {file: string, language: string, code: string}, chat: {file: string, language: string, code: string}, page?: {file: string, language: string, code: string}}} write `buildAppHandover`
 * @param {readonly {id: string}[]} stacks
 * @param {number} firstId
 */
export function handoverUnits(write, stacks, firstId) {
  const files = [];
  const base = { org: "acme", agent: "variance-reporter" };
  for (const baseUrl of HANDOVER_ADDRESSES) {
    for (const { id: stack } of stacks) {
      const { backend } = write({ ...base, mode: "sign-in", stack, baseUrl });
      files.push({ file: backend, variant: `the ${stack} token route at ${baseUrl}` });
    }
  }
  // The chat is the same for every stack; one per mode.
  const chatAt = files.length;
  files.push({ file: write({ ...base, mode: "sign-in", stack: "node", baseUrl: HANDOVER_ADDRESSES[0] }).chat, variant: "the chat, signed in" });
  files.push({ file: write({ ...base, mode: "local", stack: "node", baseUrl: HANDOVER_ADDRESSES[1] }).chat, variant: "the chat, on a local server" });
  // Each distinct page that tries the chat, beside the chat at the path the
  // stack names for it. A writer from before the page hands over none.
  const pages = new Set();
  for (const { id: stack } of stacks) {
    const { page, chat } = write({ ...base, mode: "sign-in", stack, baseUrl: HANDOVER_ADDRESSES[0] });
    if (page === undefined || pages.has(page.file)) continue;
    pages.add(page.file);
    files.push({ file: page, variant: `the ${stack} page that tries the chat`, siblings: [{ path: chat.file, at: chatAt }] });
  }

  let id = firstId;
  return files.map(({ file, variant, siblings = [] }) => {
    const known = LANGUAGES[file.language];
    if (known === undefined) throw new Error(`${HANDOVER_FILE} wrote ${file.file} in ${file.language}, which the snippet gate does not compile`);
    return {
      id: id++,
      page: HANDOVER_FILE,
      line: 1,
      lang: known.lang,
      language: known.language,
      generated: true,
      variant,
      kind: "file",
      title: file.file,
      text: file.code,
      setup: [],
      body: pageLines(file.code, 1),
      prelude: [],
      siblings: siblings.map(({ path, at }) => ({ path, id: firstId + at })),
    };
  });
}

/**
 * The handover's units in the tree at `root`, or none when it has no writer.
 * @param {string} root
 * @param {number} firstId
 */
export async function handoverSnippetUnits(root, firstId) {
  if (!existsSync(join(root, HANDOVER_FILE))) return [];
  const built = join(root, HANDOVER_BUILT);
  if (!existsSync(built)) {
    throw new Error(`${HANDOVER_BUILT} is missing: build the libraries first (npm run build:libs)`);
  }
  const { buildAppHandover, APP_HANDOVER_STACKS } = await import(pathToFileURL(built).href);
  return handoverUnits(buildAppHandover, APP_HANDOVER_STACKS, firstId);
}
