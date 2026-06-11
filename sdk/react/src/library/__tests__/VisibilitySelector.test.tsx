import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  VisibilitySelector,
  VisibilityBadge,
} from "../VisibilitySelector";
import {
  INSTANCE_VISIBILITY_LEVELS,
  blueprintVisibilityLevels,
} from "../visibilityLevels";

// Without a StigmerProvider the portal container is null, and Base UI's
// Portal renders nothing — pin it to document.body so the popover mounts.
vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

// Base UI's Popover positioner observes its anchor; happy-dom lacks
// ResizeObserver, so provide a no-op shim.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

const BLUEPRINT_LEVELS = blueprintVisibilityLevels({
  deploymentMode: "cloud",
  hasIdentityProvider: true,
});

// Option accessible names are "<label> <description>"; anchor on the label so
// e.g. /^Organization/ does not also match Platform's "All organizations …".
const optionByLabel = (label: string) =>
  screen.getByRole("option", { name: new RegExp(`^${label}`, "i") });

/** Opens the manage-mode popover, resolving once its option rows are mounted. */
async function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: /Resource visibility:/i }));
  await screen.findByRole("option", { name: /^Private/i });
}

describe("VisibilitySelector — create mode (inline list)", () => {
  it("renders every offered level with its label and description", () => {
    render(
      <VisibilitySelector
        mode="create"
        visibility={ApiResourceVisibility.visibility_private}
        options={INSTANCE_VISIBILITY_LEVELS}
        onVisibilityChange={() => {}}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Resource visibility" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByText("Private")).toBeTruthy();
    expect(within(group).getByText("Organization")).toBeTruthy();
    expect(within(group).getByText("Public")).toBeTruthy();
    expect(within(group).getByText("Only you can access")).toBeTruthy();
  });

  it("applies any selection immediately, with no confirmation", () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        mode="create"
        visibility={ApiResourceVisibility.visibility_private}
        options={INSTANCE_VISIBILITY_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    // Public is an escalation, but in create mode there is nothing to escalate.
    fireEvent.click(screen.getByRole("radio", { name: /Public/i }));
    expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_public);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the current level even when it is not offerable", () => {
    render(
      <VisibilitySelector
        mode="create"
        visibility={ApiResourceVisibility.visibility_platform}
        options={INSTANCE_VISIBILITY_LEVELS}
        onVisibilityChange={() => {}}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Resource visibility" });
    const platformRow = within(group).getByText("Platform").closest("button");
    expect(platformRow).not.toBeNull();
    expect(platformRow?.getAttribute("aria-checked")).toBe("true");
  });

  it("disables interaction when disabled", () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        mode="create"
        disabled
        visibility={ApiResourceVisibility.visibility_private}
        options={INSTANCE_VISIBILITY_LEVELS}
        onVisibilityChange={onChange}
      />,
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("VisibilitySelector — manage mode (popover + confirmation)", () => {
  it("shows the current level on the trigger and lists levels on open", async () => {
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_org}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Resource visibility: Organization" }),
    ).toBeTruthy();

    await openPopover();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("applies a de-escalation immediately, without confirmation", async () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_public}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    await openPopover();
    fireEvent.click(optionByLabel("Private"));
    expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_private);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("requires an inline confirm before escalating to Organization", async () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_private}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    await openPopover();
    fireEvent.click(optionByLabel("Organization"));

    // Not applied yet — an inline prompt appears first.
    expect(onChange).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert).toBeTruthy();

    fireEvent.click(within(alert).getByRole("button", { name: "Confirm" }));
    expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_org);
  });

  it("requires the confirm dialog before escalating to Public", async () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_org}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    await openPopover();
    fireEvent.click(optionByLabel("Public"));

    // Not applied until the modal is confirmed.
    expect(onChange).not.toHaveBeenCalled();
    expect(await screen.findByText("Make this public?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make Public" }));
    // The confirm resolves on a microtask, so the apply is asynchronous.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_public),
    );
  });

  it("moves focus between options with the arrow keys", async () => {
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_org}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={() => {}}
      />,
    );

    await openPopover();
    // Opening focuses the current level.
    await waitFor(() =>
      expect(document.activeElement).toBe(optionByLabel("Organization")),
    );

    fireEvent.keyDown(optionByLabel("Organization"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(optionByLabel("Platform"));

    fireEvent.keyDown(optionByLabel("Platform"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(optionByLabel("Organization"));
  });

  it("does not apply when the confirm dialog is cancelled", async () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_org}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    await openPopover();
    fireEvent.click(optionByLabel("Public"));
    await screen.findByText("Make this public?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Make this public?")).toBeNull(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("VisibilityBadge", () => {
  it("renders the human label for a visibility value", () => {
    render(<VisibilityBadge visibility={ApiResourceVisibility.visibility_platform} />);
    expect(screen.getByText("Platform")).toBeTruthy();
  });
});
