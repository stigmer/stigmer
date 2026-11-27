// Tests for the chat's setup-failure classification by cause: an already
// classified failure passes through, an app user refused by an organization
// that is not their own hears the embedding settings' sign-in role, any
// other failure is "unknown" and names what the client raised, and the
// browser's console hears each cause once in a page.

import { describe, it, expect, vi, afterEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentChatSetupError, classifyAgentSetupFailure, reportSetupFailure } from "../setup-error";

afterEach(() => {
  vi.restoreAllMocks();
});

const CONTEXT = { org: "acme", agent: "reporter", orgIsMine: true, appUser: false } as const;

describe("classifyAgentSetupFailure", () => {
  it("passes an already classified failure through unchanged", () => {
    const classified = new AgentChatSetupError("no-credential", "dev words", "end-user words", null);
    expect(classifyAgentSetupFailure(classified, CONTEXT)).toBe(classified);
  });

  it("tells an app user refused outside their own organizations to set a sign-in role", () => {
    const denied = new ConnectError("denied", Code.PermissionDenied);
    const failure = classifyAgentSetupFailure(denied, { ...CONTEXT, orgIsMine: false, appUser: true });
    expect(failure.reason).toBe("no-access");
    expect(failure.message).toContain("set a sign-in role in Settings → Embedding");
    expect(failure.cause).toBe(denied);
  });

  it("reads any other failure as unknown and names what the client raised", () => {
    const failure = classifyAgentSetupFailure(new ConnectError("boom", Code.Internal), CONTEXT);
    expect(failure.reason).toBe("unknown");
    expect(failure.message).toContain("the chat could not start:");
    expect(failure.message).toContain("boom");
    expect(classifyAgentSetupFailure("a thrown string", CONTEXT).message).toContain("a thrown string");
  });
});

describe("reportSetupFailure", () => {
  it("writes each cause to the console once in a page", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new AgentChatSetupError("agent-not-found", "acme has no agent named \"once\"", "gone", null);
    reportSetupFailure(failure);
    reportSetupFailure(new AgentChatSetupError("agent-not-found", "acme has no agent named \"once\"", "gone", null));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("Stigmer: acme has no agent named \"once\"", null);
  });
});
