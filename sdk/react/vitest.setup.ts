import { configure } from "@testing-library/react";

// Portaled Base UI content (menus, dialogs, popovers) mounts asynchronously,
// so tests wait for it with `findBy*`/`waitFor`. Testing-library's default
// 1s async timeout races that mount on loaded CI runners — the same test
// passes locally and flakes in CI. Raise the suite-wide default instead of
// sprinkling per-call timeouts: passing tests are unaffected (waits resolve
// the moment the element appears); only genuinely failing waits report later.
//
// Kept below the raised vitest testTimeout (vitest.config.ts) so a failing
// wait still surfaces the informative testing-library error with a DOM dump,
// never a bare vitest "test timed out".
configure({ asyncUtilTimeout: 4000 });

// No test may reach the real network. Any code path that calls the global
// fetch unmocked fails immediately, in the right test file, instead of
// escaping to the OS resolver and flaking order-dependently (issue #334).
// Tests that need fetch install their own stub (vi.stubGlobal / assignment),
// which simply replaces this default. Navigations that bypass the global
// fetch are blocked separately via happy-dom settings in vitest.config.ts.
globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
  throw new Error(
    `Unmocked network call in test: fetch(${String(input)}). ` +
      "Stub fetch in this test file (e.g. vi.stubGlobal) instead of letting " +
      "requests reach the network.",
  );
};
