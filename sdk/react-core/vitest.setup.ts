import { configure } from "@testing-library/react";

// The same two rules as the React kit's suite (sdk/react/vitest.setup.ts),
// whose hook tests these were until the conversation core became its own
// package. A hook's `waitFor` gets the kit's generous allowance: on a
// starved CI runner the 1s default fails waits that pass locally (#323), and
// a long wait only delays the report of a real failure, never a pass.
//
// Kept below the raised vitest testTimeout (vitest.config.ts) so a failing
// wait still surfaces the informative testing-library error with a DOM dump,
// never a bare vitest "test timed out".
configure({ asyncUtilTimeout: 8000 });

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
