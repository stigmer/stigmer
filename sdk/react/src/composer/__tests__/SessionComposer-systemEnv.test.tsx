/**
 * What a submitted conversation's own secrets carry (stigmer/stigmer#1446):
 * only values the page collected. The composer adds nothing of
 * its own: `STIGMER_SERVER_ADDRESS` is the platform's to fill in the runner,
 * below every value a user saved, and the signed-in user's bearer never
 * rides a conversation as `STIGMER_API_KEY`, where an agent that declares no
 * env would carry it into its shell. A value the user types still reaches the
 * conversation, by name and value alone, the platform's key name included.
 * A value marked "Save in My vault" that fails to save still reaches the
 * conversation, and the person is told it was not saved, under the toolbar
 * and through `onMyVaultSaveError`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import type { EnvVarInput } from "../../vault/types.js";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { PublicBaseUrlContext } from "../../public-base-url-context";
import type { UseSessionVariablesReturn } from "../../run/useSessionVariables";
import { SessionComposer } from "../SessionComposer";

function clientAt(baseUrl: string): Stigmer {
  return {
    run: { uploadAttachment: vi.fn() },
    baseUrl,
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: { baseUrl, getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
}

/** Session variables holding exactly `env`, as the editor would after typing. */
function typedVariables(env: Record<string, EnvVarInput>): UseSessionVariablesReturn {
  return {
    entries: [],
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    updateEntry: vi.fn(),
    clear: vi.fn(),
    isEmpty: false,
    hasValidEntries: true,
    toSessionSecrets: () => env,
    toSaveForFutureEnv: () => ({}),
    hasSaveForFutureEntries: false,
  };
}

async function submit(opts: {
  baseUrl: string;
  publicBaseUrl?: string;
  sessionVariables?: UseSessionVariablesReturn;
  onMyVaultSaveError?: (message: string) => void;
}): Promise<{ secrets: Record<string, string> | undefined; client: Stigmer }> {
  const onSubmit = vi.fn();
  const client = clientAt(opts.baseUrl);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <PublicBaseUrlContext.Provider value={opts.publicBaseUrl}>
          <ModelRegistryContext.Provider
            value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
          >
            {children}
          </ModelRegistryContext.Provider>
        </PublicBaseUrlContext.Provider>
      </StigmerContext.Provider>
    );
  }
  render(
    <SessionComposer
      onSubmit={onSubmit}
      sessionVariables={opts.sessionVariables}
      onMyVaultSaveError={opts.onMyVaultSaveError}
    />,
    { wrapper: Wrapper },
  );

  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Hello" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  return { secrets: onSubmit.mock.calls[0][2]?.secrets, client };
}

afterEach(cleanup);

describe("SessionComposer — a conversation's own secrets carry only what the page collected", () => {
  it.each([
    ["an absolute client base URL", "http://localhost:8080", undefined],
    ["a relative base URL behind a public one", "/", "https://api.example.com"],
    ["a relative base URL with no public one", "/", undefined],
  ])("sends no secrets for a plain submit with %s", async (_label, baseUrl, publicBaseUrl) => {
    const { secrets, client } = await submit({ baseUrl, publicBaseUrl });

    expect(secrets).toBeUndefined();
    expect(client.getAuthCredential, "the bearer is never read for a run").not.toHaveBeenCalled();
  });

  it("carries a value the user typed, a platform key name included", async () => {
    const typed = { STIGMER_SERVER_ADDRESS: { value: "mcp.internal:7234", isSecret: false } };
    const { secrets } = await submit({
      baseUrl: "https://api.example.com",
      sessionVariables: typedVariables(typed),
    });

    expect(secrets).toEqual({ STIGMER_SERVER_ADDRESS: "mcp.internal:7234" });
  });

  it("still sends a save-for-future value to the conversation when saving it fails, and says it was not saved", async () => {
    // No agent or MCP picker means no org for My vault, so saving the value
    // is refused; the submit goes on and the value reaches the conversation
    // as its own secret.
    const typed = { GITHUB_TOKEN: { value: "ghp_x", isSecret: true } };
    const variables: UseSessionVariablesReturn = {
      ...typedVariables(typed),
      toSaveForFutureEnv: () => typed,
      hasSaveForFutureEntries: true,
    };
    const onMyVaultSaveError = vi.fn();
    const { secrets } = await submit({
      baseUrl: "https://api.example.com",
      sessionVariables: variables,
      onMyVaultSaveError,
    });

    expect(secrets).toEqual({ GITHUB_TOKEN: "ghp_x" });
    expect(onMyVaultSaveError).toHaveBeenCalledOnce();
    const notice = String(onMyVaultSaveError.mock.calls[0][0]);
    expect(notice).toContain("Not saved in My vault");
    expect(notice).toContain("used for this conversation only");
    expect(screen.getByRole("alert").textContent).toBe(notice);
  });

  it("shows no save notice when nothing is marked for My vault", async () => {
    const onMyVaultSaveError = vi.fn();
    await submit({
      baseUrl: "https://api.example.com",
      sessionVariables: typedVariables({ REPO: { value: "acme/app", isSecret: false } }),
      onMyVaultSaveError,
    });

    expect(onMyVaultSaveError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
