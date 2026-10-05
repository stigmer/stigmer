/**
 * Pins the workflow's run visibility control: a change calls the workflow's
 * own `updateExecutionVisibility` RPC with the workflow's id and the chosen
 * level, hands the host the updated workflow on success (so a host's own
 * copy, the run dialog's, follows the change), never calls for the level already
 * set, reads an unspecified level as private, and shows the server's
 * refusal. The copy says the setting reaches every run, past runs included.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { StigmerContext } from "../../context";
import { RunVisibilityControl } from "../RunVisibilityControl";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderControl(
  executionVisibility: WorkflowExecutionVisibility,
  updateExecutionVisibility: (input: unknown) => Promise<unknown>,
) {
  const onChanged = vi.fn();
  const client = {
    workflow: { updateExecutionVisibility },
  } as unknown as Stigmer;
  render(
    <StigmerContext.Provider value={client}>
      <RunVisibilityControl
        workflowId="wf_1"
        executionVisibility={executionVisibility}
        onChanged={onChanged}
      />
    </StigmerContext.Provider>,
  );
  return { onChanged };
}

function option(name: RegExp): HTMLElement {
  return screen.getByRole("radio", { name });
}

describe("RunVisibilityControl", () => {
  it("calls the workflow's updateExecutionVisibility with its id and the chosen level", async () => {
    const updated = { metadata: { id: "wf_1" } };
    const update = vi.fn(async () => updated);
    const { onChanged } = renderControl(WorkflowExecutionVisibility.private, update);

    fireEvent.click(option(/^All organization members/));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledWith(updated);
    expect(update).toHaveBeenCalledTimes(1);
    const input = (update.mock.calls[0] as unknown as [
      { resourceId: string; executionVisibility: WorkflowExecutionVisibility },
    ])[0];
    expect(input.resourceId).toBe("wf_1");
    expect(input.executionVisibility).toBe(WorkflowExecutionVisibility.organization);
  });

  it("reads an unspecified level as private and does not call for the level already set", () => {
    const update = vi.fn(async () => ({}));
    renderControl(WorkflowExecutionVisibility.unspecified, update);

    const privateOption = option(/^Only the person who runs it/);
    expect(privateOption.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(privateOption);
    expect(update).not.toHaveBeenCalled();
  });

  it("says the setting reaches every run, past runs included", () => {
    renderControl(WorkflowExecutionVisibility.private, vi.fn(async () => ({})));

    expect(option(/^All organization members/).textContent).toContain(
      "past runs included",
    );
  });

  it("shows the server's refusal and does not report a change", async () => {
    const update = vi.fn(async () => {
      throw new Error("You cannot change who sees this workflow's runs.");
    });
    const { onChanged } = renderControl(WorkflowExecutionVisibility.private, update);

    fireEvent.click(option(/^All organization members/));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
