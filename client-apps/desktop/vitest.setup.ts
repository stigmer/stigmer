// ---------------------------------------------------------------------------
// The desktop app's test harness: one setup for every test file
//
// Mirrors sdk/react/vitest.setup.ts and the web console's, so a test behaves
// the same in all three, and adds the one thing only the desktop needs:
// dropping the Tauri IPC mock (src/__test-utils__/tauri.ts) after each test.
// ---------------------------------------------------------------------------

import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";

// The config sets no vitest globals, so testing-library cannot register its
// own automatic cleanup. Unmount here, once, then drop the IPC mock so no
// test inherits another's command handlers or event listeners. An unmounted
// component unlistens asynchronously (`listen` returns a promise), so let
// one real macrotask pass first: dropping the mock under a pending unlisten
// would throw from a test that has already finished.
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
});

// The same allowance as sdk/react (its setup file has the history, #323). A
// generous wait only delays the report of a real failure, never a pass.
configure({ asyncUtilTimeout: 8000 });

// No test may reach the real network (sdk/react, issue #334). A test that
// needs fetch installs its own stub, which replaces this default. Calls made
// through Tauri's HTTP plugin never reach this: they are IPC.
globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
  throw new Error(
    `Unmocked network call in test: fetch(${String(input)}). ` +
      "Stub fetch in this test file (e.g. vi.stubGlobal) instead of letting " +
      "requests reach the network.",
  );
};
