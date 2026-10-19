/**
 * SetupProgress's timer fallback reads the conversation's resources: a git
 * repository among them adds the "Setting up workspace" step after the
 * first; a conversation holding only Files has nothing to clone and goes
 * straight to preparing the agent's environment.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { SetupProgress } from "../SetupProgress";

const repository = create(SessionResourceSchema, {
  name: "acme/api",
  resource: { case: "gitRepository", value: { url: "https://github.com/acme/api.git" } },
});
const file = create(SessionResourceSchema, { resource: { case: "file", value: { fileId: "file_1" } } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function secondStep(resources: Parameters<typeof SetupProgress>[0]["resources"]): string | null {
  vi.useFakeTimers();
  render(<SetupProgress resources={resources} />);
  act(() => {
    vi.advanceTimersByTime(4000);
  });
  return screen.getByRole("status").getAttribute("aria-label");
}

describe("SetupProgress — the timer fallback over resources", () => {
  it("sets up the workspace when a git repository is among them", () => {
    expect(secondStep([file, repository])).toBe("Setting up workspace…");
  });

  it("skips the workspace step for a conversation holding only Files", () => {
    expect(secondStep([file])).toBe("Preparing agent environment…");
  });
});
