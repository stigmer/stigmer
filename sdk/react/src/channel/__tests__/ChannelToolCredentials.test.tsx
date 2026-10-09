/**
 * ChannelToolCredentials' readiness hint names the vaults that cannot serve
 * the channel's runs (one or several, worded for each), and says nothing
 * when the channel is ready. The readiness hook and the picker are stood in:
 * their own suites pin them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelToolCredentials } from "../ChannelToolCredentials";

const readiness = vi.hoisted(() => ({ value: { status: "ready" } as Record<string, unknown> }));
vi.mock("../useChannelToolReadiness", () => ({
  useChannelToolReadiness: () => readiness.value,
}));
vi.mock("../../vault/VaultPicker", () => ({ VaultPicker: () => <div>picker</div> }));

afterEach(cleanup);

const agent = {} as Agent;

function renderHint() {
  render(<ChannelToolCredentials agent={agent} org="acme" value={[]} onChange={() => {}} />);
}

describe("ChannelToolCredentials", () => {
  it("names one vault that cannot serve", () => {
    readiness.value = { status: "blocked", unusableVaults: ["acme/private"] };
    renderHint();
    expect(screen.getByText("acme/private")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/the vault acme\/private is not a shared vault/);
  });

  it("names several vaults that cannot serve", () => {
    readiness.value = { status: "blocked", unusableVaults: ["acme/a", "acme/b"] };
    renderHint();
    expect(screen.getByRole("status").textContent).toMatch(/the vaults acme\/a, acme\/b are not/);
  });

  it("says nothing when the channel is ready", () => {
    readiness.value = { status: "ready" };
    renderHint();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
