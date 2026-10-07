/**
 * Pins that every place a worker is composed registers the run credential's
 * activity inbound interceptor (`interceptors/run-credential-activity.ts`):
 * the two roots that create workers.
 *
 * Why a fence and not a comment: a root that forgot it would present the
 * operator's API key on every member's run — the failure this whole design
 * exists to end — and on the desktop (the manager root) it would be
 * invisible, because a person's own runner works for that person either way.
 * The roots are read off the TypeScript syntax tree
 * (`__test-utils__/module-specifiers.ts`) for the imports and off the source
 * for the one placement each import must have.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  moduleSpecifiers,
  readSource,
} from "../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

const ACTIVITY_END = "./interceptors/run-credential-activity.js";

function root(file: string): {
  file: string;
  source: string;
  specifiers: string[];
} {
  const path = `${SRC_ROOT}${file}`;
  const source = readSource(path);
  return { file, source, specifiers: moduleSpecifiers(path, source) };
}

describe("run-credential registration", () => {
  for (const file of ["worker.ts", "runner-manager.ts"]) {
    it(`${file} registers the activity interceptor`, () => {
      const { specifiers, source } = root(file);
      expect(
        specifiers,
        `${file} must import the activity interceptor`,
      ).toContain(ACTIVITY_END);
      expect(
        source,
        `${file} must place runCredentialActivityInterceptor in its activity interceptors`,
      ).toMatch(
        /ActivityInterceptorsFactory\[\]\s*=\s*\[runCredentialActivityInterceptor\]/,
      );
    });
  }
});
