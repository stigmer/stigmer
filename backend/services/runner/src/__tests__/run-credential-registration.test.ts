/**
 * Pins that every place a worker is composed registers BOTH ends of the run
 * credential (`shared/run-credential.ts`): the activity inbound interceptor
 * in the two roots that create workers, and the workflow interceptor module
 * in the two runtime-bundling roots and the pre-built bundle script.
 *
 * Why a fence and not a comment: a root that forgot the activity end would
 * present the operator's API key on every member's run — the failure this
 * whole design exists to end — and on the desktop (the manager root) it
 * would be invisible, because a person's own runner works for that person
 * either way. The roots are read off the TypeScript syntax tree
 * (`__test-utils__/module-specifiers.ts`) for the imports and off the source
 * for the one call each import must make; the build script is JavaScript
 * and is read as text.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  moduleSpecifiers,
  readSource,
} from "../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));
const RUNNER_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const ACTIVITY_END = "./interceptors/run-credential-activity.js";
const WORKFLOW_END_RESOLVER = "runCredentialWorkflowInterceptorModule";

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
    it(`${file} registers the activity end and resolves the workflow end`, () => {
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
      expect(
        source,
        `${file} must resolve the workflow interceptor module`,
      ).toContain(`${WORKFLOW_END_RESOLVER}()`);
    });
  }

  it("scripts/bundle-slim.mjs bakes the workflow end into the pre-built bundle", () => {
    const source = readSource(`${RUNNER_ROOT}scripts/bundle-slim.mjs`);
    expect(source).toMatch(
      new RegExp(
        `workflowInterceptorModules:\\s*\\[\\s*${WORKFLOW_END_RESOLVER}\\(\\)`,
      ),
    );
  });

  it("the workflow end is a sandbox module: it imports nothing from Node", () => {
    const path = `${SRC_ROOT}workflows/interceptors/run-credential.ts`;
    const nodeImports = moduleSpecifiers(path, readSource(path)).filter((s) =>
      s.startsWith("node:"),
    );
    expect(nodeImports).toEqual([]);
    const wirePath = `${SRC_ROOT}shared/run-credential.ts`;
    expect(moduleSpecifiers(wirePath, readSource(wirePath))).toEqual([]);
  });
});
