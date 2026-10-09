/**
 * What a submit carries of the platform's own keys (stigmer/stigmer#1446):
 * nothing. The composer adds no value of its own: `STIGMER_SERVER_ADDRESS`
 * is the platform's to fill in the runner, below every value a user saved,
 * and the signed-in user's bearer is never read for a run, so it never
 * rides a conversation as `STIGMER_API_KEY`, where an agent that declares
 * no env would carry it into its shell. A plain submit hands `onSubmit` no
 * context at all.
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
    run: { uploadAttachment: vi.fn() },
    baseUrl,
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: { baseUrl, getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
}

async function submit(opts: {
  baseUrl: string;
  publicBaseUrl?: string;
}): Promise<{ context: unknown; client: Stigmer }> {
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
    <SessionComposer onSubmit={onSubmit} />,
    { wrapper: Wrapper },
  );

  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Hello" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  return { context: onSubmit.mock.calls[0][2], client };
}

afterEach(cleanup);

describe("SessionComposer — a submit carries nothing of the platform's own", () => {
  it.each([
    ["an absolute client base URL", "http://localhost:8080", undefined],
    ["a relative base URL behind a public one", "/", "https://api.example.com"],
    ["a relative base URL with no public one", "/", undefined],
  ])("sends no context for a plain submit with %s", async (_label, baseUrl, publicBaseUrl) => {
    const { context, client } = await submit({ baseUrl, publicBaseUrl });

    expect(context).toBeUndefined();
    expect(client.getAuthCredential, "the bearer is never read for a run").not.toHaveBeenCalled();
  });
});
