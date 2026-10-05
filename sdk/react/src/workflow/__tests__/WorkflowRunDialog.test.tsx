/**
 * Pins the run dialog as a person sees it, with the real run flow and form
 * underneath and only the client faked:
 *
 * - there is no picker of any kind, and Run creates the run with the
 *   workflow's id alone;
 * - every declared key carries its source: typed here (passed with the
 *   run), held by the person's personal environment, or missing;
 * - a workflow of another organization than the run's marks no key as
 *   coming from the personal environment, since the server fills none;
 * - when the workflow's runs are visible to its organization, the dialog
 *   says so before the run starts, and says nothing otherwise.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { StigmerContext } from "../../context";
import { WorkflowRunDialog } from "../WorkflowRunDialog";

beforeAll(() => {
  // happy-dom does not implement the native <dialog> modal API.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DECLARED_ENV = {
  TYPED_KEY: { optional: false, isSecret: false },
  SAVED_KEY: { optional: false, isSecret: true },
  ABSENT_KEY: { optional: true, isSecret: false },
};

function makeWorkflow(overrides?: {
  org?: string;
  executionVisibility?: WorkflowExecutionVisibility;
}): Workflow {
  return {
    metadata: {
      id: "wf_1",
      name: "nightly-triage",
      slug: "nightly-triage",
      org: overrides?.org ?? "org_acme",
    },
    spec: {
      env: DECLARED_ENV,
      executionVisibility:
        overrides?.executionVisibility ?? WorkflowExecutionVisibility.private,
    },
  } as unknown as Workflow;
}

function makeClient(personalKeys: readonly string[]) {
  const create = vi.fn(async () => ({ metadata: { id: "wex_1" } }));
  const list = vi.fn(async () => ({
    items: [
      {
        metadata: { id: "env_personal", org: "org_acme" },
        spec: {
          data: Object.fromEntries(
            personalKeys.map((k) => [k, { value: "", isSecret: true }]),
          ),
        },
      },
    ],
    totalCount: 1,
  }));
  const client = {
    workflowExecution: { create },
    environment: { list },
  } as unknown as Stigmer;
  return { client, create, list };
}

function renderDialog(workflow: Workflow, client: Stigmer) {
  const onSuccess = vi.fn();
  render(
    <StigmerContext.Provider value={client}>
      <WorkflowRunDialog
        open
        onOpenChange={vi.fn()}
        org="org_acme"
        workflow={workflow}
        onSuccess={onSuccess}
        onError={vi.fn()}
      />
    </StigmerContext.Provider>,
  );
  return { onSuccess };
}

/** The source marker rendered beside a key's label. */
function markerOf(key: string): string | null {
  const field = screen.getByLabelText(new RegExp(`^${key}`));
  const group = field.parentElement as HTMLElement;
  return group.querySelector("[data-source]")?.getAttribute("data-source") ?? null;
}

describe("WorkflowRunDialog", () => {
  it("offers no picker and creates the run with the workflow's id alone", async () => {
    const { client, create } = makeClient(["SAVED_KEY"]);
    const { onSuccess } = renderDialog(makeWorkflow(), client);

    expect(screen.queryByRole("combobox")).toBeNull();

    await waitFor(() => expect(markerOf("SAVED_KEY")).toBe("personal"));
    fireEvent.change(screen.getByLabelText(/^TYPED_KEY/), {
      target: { value: "typed-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("wex_1"));
    const input = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(input.workflowId).toBe("wf_1");
    expect(input.org).toBe("org_acme");
    expect(Object.keys(input)).not.toContain("workflowInstanceId");
    expect(input.runtimeEnv).toEqual({
      TYPED_KEY: { value: "typed-value", isSecret: false },
    });
  });

  it("marks each declared key typed, from the personal environment, or missing", async () => {
    const { client } = makeClient(["SAVED_KEY"]);
    renderDialog(makeWorkflow(), client);

    await waitFor(() => expect(markerOf("SAVED_KEY")).toBe("personal"));
    expect(markerOf("TYPED_KEY")).toBe("missing");
    expect(markerOf("ABSENT_KEY")).toBe("missing");

    fireEvent.change(screen.getByLabelText(/^TYPED_KEY/), {
      target: { value: "typed-value" },
    });
    expect(markerOf("TYPED_KEY")).toBe("typed");

    const saved = screen.getByLabelText(/^SAVED_KEY/).parentElement as HTMLElement;
    expect(within(saved).getByText("From your personal environment")).toBeTruthy();
    expect(screen.getAllByText("Missing")).toHaveLength(1);
    expect(screen.getByText("Passed with this run")).toBeTruthy();
  });

  it("does not demand a required key the personal environment holds", async () => {
    const { client, create } = makeClient(["SAVED_KEY", "TYPED_KEY"]);
    const { onSuccess } = renderDialog(makeWorkflow(), client);

    await waitFor(() => expect(markerOf("TYPED_KEY")).toBe("personal"));
    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is required/)).toBeNull();
  });

  it("marks no key from the personal environment for a workflow of another organization", async () => {
    const { client, create, list } = makeClient(["SAVED_KEY"]);
    renderDialog(makeWorkflow({ org: "org_parent" }), client);

    expect(markerOf("SAVED_KEY")).toBe("missing");
    expect(screen.queryByText("From your personal environment")).toBeNull();
    expect(list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run Workflow" }));
    expect(await screen.findByText("SAVED_KEY is required")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("says before the run starts that runs visible to the organization include this one", () => {
    const { client } = makeClient([]);
    renderDialog(
      makeWorkflow({
        executionVisibility: WorkflowExecutionVisibility.organization,
      }),
      client,
    );

    const notice = screen.getByRole("note");
    expect(notice.textContent).toContain("visible to everyone in its organization");
    expect(notice.textContent).toContain("input and output");
  });

  it("says nothing about organization visibility when runs are private", () => {
    const { client } = makeClient([]);
    renderDialog(makeWorkflow(), client);

    expect(screen.queryByRole("note")).toBeNull();
  });
});
