/**
 * The system env vars a submitted session carries (stigmer/stigmer#1433):
 * STIGMER_SERVER_ADDRESS is the server's public address, the provider's
 * `publicBaseUrl` first, else an absolute client `baseUrl`, and absent
 * rather than guessed when neither names one; STIGMER_API_KEY rides along
 * either way.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { PublicBaseUrlContext } from "../../public-base-url-context";
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

async function submittedRuntimeEnv(
  baseUrl: string,
  publicBaseUrl?: string,
): Promise<Record<string, { value: string }> | undefined> {
  const onSubmit = vi.fn();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={clientAt(baseUrl)}>
        <PublicBaseUrlContext.Provider value={publicBaseUrl}>
          <ModelRegistryContext.Provider
            value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
          >
            {children}
          </ModelRegistryContext.Provider>
        </PublicBaseUrlContext.Provider>
      </StigmerContext.Provider>
    );
  }
  render(<SessionComposer onSubmit={onSubmit} />, { wrapper: Wrapper });

  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Hello" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  return onSubmit.mock.calls[0][2]?.runtimeEnv;
}

afterEach(cleanup);

describe("SessionComposer — system env vars", () => {
  it("derives the address from an absolute client base URL, as before", async () => {
    const env = await submittedRuntimeEnv("http://localhost:8080");

    expect(env?.STIGMER_SERVER_ADDRESS?.value).toBe("localhost:8080");
  });

  it("uses the host's public base URL behind a relative client base URL", async () => {
    const env = await submittedRuntimeEnv("/", "https://api.example.com");

    expect(env?.STIGMER_SERVER_ADDRESS?.value).toBe("api.example.com:443");
  });

  it("never injects an address nobody can dial for a relative base URL with no public one", async () => {
    const env = await submittedRuntimeEnv("/");

    expect(env).not.toHaveProperty("STIGMER_SERVER_ADDRESS");
    expect(env?.STIGMER_API_KEY?.value).toBe("test-token");
  });
});
