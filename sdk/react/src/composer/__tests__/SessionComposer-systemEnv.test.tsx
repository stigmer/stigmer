/**
 * What a submitted session's runtime env carries (stigmer/stigmer#1446):
 * only values the page collected for this run. The composer adds nothing of
 * its own: `STIGMER_SERVER_ADDRESS` is the platform's to fill in the runner,
 * below every value a user saved, and the signed-in user's bearer never
 * rides a run as `STIGMER_API_KEY`, where an agent that declares no env
 * would carry it into its shell. A value the user types for the run still
 * reaches it, the platform's key name included.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { EnvVarInput, Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { PublicBaseUrlContext } from "../../public-base-url-context";
import type { UseSessionVariablesReturn } from "../../execution/useSessionVariables";
import { SessionComposer } from "../SessionComposer";

function clientAt(baseUrl: string): Stigmer {
  return {
    agentExecution: { uploadAttachment: vi.fn() },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
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
    toRuntimeEnv: () => env,
    toSaveForFutureEnv: () => ({}),
    hasSaveForFutureEntries: false,
  };
}

async function submit(opts: {
  baseUrl: string;
  publicBaseUrl?: string;
  sessionVariables?: UseSessionVariablesReturn;
}): Promise<{ runtimeEnv: Record<string, EnvVarInput> | undefined; client: Stigmer }> {
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
  render(<SessionComposer onSubmit={onSubmit} sessionVariables={opts.sessionVariables} />, {
    wrapper: Wrapper,
  });

  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Hello" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  return { runtimeEnv: onSubmit.mock.calls[0][2]?.runtimeEnv, client };
}

afterEach(cleanup);

describe("SessionComposer — runtime env carries only what the page collected", () => {
  it.each([
    ["an absolute client base URL", "http://localhost:8080", undefined],
    ["a relative base URL behind a public one", "/", "https://api.example.com"],
    ["a relative base URL with no public one", "/", undefined],
  ])("sends no runtime env for a plain submit with %s", async (_label, baseUrl, publicBaseUrl) => {
    const { runtimeEnv, client } = await submit({ baseUrl, publicBaseUrl });

    expect(runtimeEnv).toBeUndefined();
    expect(client.getAuthCredential, "the bearer is never read for a run").not.toHaveBeenCalled();
  });

  it("carries a value the user typed, a platform key name included", async () => {
    const typed = { STIGMER_SERVER_ADDRESS: { value: "mcp.internal:7234", isSecret: false } };
    const { runtimeEnv } = await submit({
      baseUrl: "https://api.example.com",
      sessionVariables: typedVariables(typed),
    });

    expect(runtimeEnv).toEqual(typed);
  });
});
