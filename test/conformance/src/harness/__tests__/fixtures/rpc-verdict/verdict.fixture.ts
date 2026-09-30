// The call verdict's fixture: tests that tell the truth about the RPC they
// send, one that lies, one that fails on its own, and a suite hook that
// sends. Run only by run-fixture.ts; ../../rpc-recorder.test.ts reads the
// report and names what each case must show.
// Domain: conformance harness (the RPC contract's call verdict).
//
// Every call goes to a port nothing listens on and is expected to reject:
// the recorder attributes a call when it is issued, so no server is needed.
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { createTransport, makeClients, type ConformanceClients } from "../../../clients";
import { getFreePort } from "../../../ports";

let clients: ConformanceClients;

beforeAll(async () => {
  clients = makeClients(createTransport(`http://127.0.0.1:${await getFreePort()}`));
  // A hook's call is recorded apart and never satisfies a tag.
  await expect(clients.agentCommand.create({})).rejects.toThrow();
});

afterAll(async () => {
  // Sent after the file's last test: vitest's current-test name still names
  // that test here, and the call must be neither charged to it nor refused.
  await expect(clients.agentQuery.get({})).rejects.toThrow();
});

it("[rpc:AgentQueryController.get] honest: sends the RPC it claims", async () => {
  // Twice: the ledger keeps one line per distinct call site.
  await expect(clients.agentQuery.get({})).rejects.toThrow();
  await expect(clients.agentQuery.get({})).rejects.toThrow();
});

it("[rpc:AgentCommandController.create] lying: claims an RPC it never sends", async () => {
  await expect(clients.agentQuery.get({})).rejects.toThrow();
});

it("[rpc:AgentCommandController.delete] failing: fails on its own before the verdict", async () => {
  await expect(clients.agentQuery.get({})).rejects.toThrow();
  expect("its own assertion").toBe("failing");
});

it("[rpc:AgentQueryController.get] cleanup-only: sends its RPC only from its own finished hook", () => {
  // vitest drops a finished-hook registered while the finished hooks run, so
  // this test's verdict is never registered and its attempt stays open.
  onTestFinished(async () => {
    await expect(clients.agentQuery.get({})).rejects.toThrow();
  });
});

it("[rpc:AgentCommandController.create] after-cleanup-only: claims an RPC it never sends, after a dropped registration", async () => {
  await expect(clients.agentQuery.get({})).rejects.toThrow();
});

describe("[rpc:AgentQueryController.get] a describe-level tag", () => {
  it("binds the test under it, which sends it", async () => {
    await expect(clients.agentQuery.get({})).rejects.toThrow();
  });

  it("binds the test under it, which sends something else", async () => {
    await expect(clients.agentCommand.create({})).rejects.toThrow();
  });
});

it("[rpc:AgentQueryController.get] last: sends the RPC it claims before the suite's afterAll", async () => {
  await expect(clients.agentQuery.get({})).rejects.toThrow();
});
