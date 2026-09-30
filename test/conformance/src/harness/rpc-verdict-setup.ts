// The call verdict's per-test hook, loaded by every suite config's
// `setupFiles`: each test that runs is judged on the RPCs it sent, a tagged
// test that sent nothing included.
// Domain: conformance harness (the RPC contract's call verdict).
//
// vitest runs this file before each test file, in that file's module graph,
// so the `beforeEach` below is the first hook on the file's root suite and
// the recorder it drives is the one the file's transports use. Its verdict is
// the test's first finished hook, and vitest runs finished hooks last
// registered first: it runs after `afterEach` and the test's own cleanups,
// and sees every call the test made. rpc-recorder.ts holds the rule.
import { beforeEach, expect } from "vitest";
import { beginTest, installRpcVerdict } from "./rpc-recorder";

installRpcVerdict({ currentFile: () => expect.getState().testPath });

beforeEach((context) => {
  const verdict = beginTest(expect.getState().currentTestName ?? context.task.name);
  context.onTestFinished(() => verdict(context.task.result?.state));
});
