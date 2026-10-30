/**
 * SessionComposer's held Send: while the launcher says the chosen model
 * cannot run here (`sendBlockedReason`), the message can still be written,
 * but Send stays disabled, carries the reason as its accessible description,
 * and Enter sends nothing. Without a reason, the same message sends. The
 * suite's title holds CON-03 on the UX bar (test/ux-bar.json): the launcher
 * says a provider is missing before a run fails.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";

afterEach(cleanup);

const REASON = "Connect Anthropic to run Claude Sonnet 4.6.";

function Wrapper({ children }: { children: ReactNode }) {
  const client = {
    vault: noMyVaultClient(),
    config: { baseUrl: "http://localhost:8080", getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
  return (
    <StigmerContext.Provider value={client}>
      <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
        {children}
      </ModelRegistryContext.Provider>
    </StigmerContext.Provider>
  );
}

function renderComposer(sendBlockedReason?: string) {
  const onSubmit = vi.fn();
  render(<SessionComposer onSubmit={onSubmit} org="acme" sendBlockedReason={sendBlockedReason} />, { wrapper: Wrapper });
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Summarise the open issues" } });
  return { onSubmit, textarea, send: screen.getByRole("button", { name: "Send message" }) };
}

describe("CON-03 Send is held, with its reason, while the chosen model cannot run", () => {
  it("disables Send and describes it with the reason, and Enter sends nothing", () => {
    const { onSubmit, textarea, send } = renderComposer(REASON);

    expect(send).toHaveProperty("disabled", true);
    const describedBy = send.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(REASON);

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the same message when nothing holds it", () => {
    const { onSubmit, send } = renderComposer();

    expect(send).toHaveProperty("disabled", false);
    expect(send.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe("Summarise the open issues");
  });
});
