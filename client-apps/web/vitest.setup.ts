// ---------------------------------------------------------------------------
// The web console's test harness: one setup for every test file
//
// Mirrors sdk/react/vitest.setup.ts, where the console's domain logic and
// most of its tests live, so a test moved between the two packages behaves
// the same in both.
// ---------------------------------------------------------------------------

import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// The config sets no vitest globals, so testing-library cannot register its
// own automatic cleanup. Unmount here, once, instead of in every file: a
// component left mounted keeps its effects running into the next test.
afterEach(() => {
  cleanup();
});

// The same allowance as sdk/react (its setup file has the history: a menu
// mount blew a 4s wait on a starved CI runner, #323). A generous wait only
// delays the report of a real failure, never a pass.
configure({ asyncUtilTimeout: 8000 });

// No test may reach the real network. A code path that calls the global
// fetch unmocked fails at once, in the right test file, instead of escaping
// to the OS resolver and flaking order-dependently (sdk/react, issue #334).
// A test that needs fetch installs its own stub (vi.stubGlobal), which
// replaces this default.
globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
  throw new Error(
    `Unmocked network call in test: fetch(${String(input)}). ` +
      "Stub fetch in this test file (e.g. vi.stubGlobal) instead of letting " +
      "requests reach the network.",
  );
};
