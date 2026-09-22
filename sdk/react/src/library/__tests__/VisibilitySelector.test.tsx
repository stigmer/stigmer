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
  instanceVisibilityLevels,
  blueprintVisibilityLevels,
  type VisibilityLevelOption,
} from "../visibilityLevels";

const INSTANCE_VISIBILITY_LEVELS = instanceVisibilityLevels();

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
    expect(radios).toHaveLength(2);
    expect(within(group).getByText("Private")).toBeTruthy();
    expect(within(group).getByText("Organization")).toBeTruthy();
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

    // Organization is an escalation, but in create mode there is nothing to escalate.
    fireEvent.click(screen.getByRole("radio", { name: /^Organization/i }));
    expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_org);
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

  it("renders a row still carrying the retired public level truthfully, and lets it move to an offered level", () => {
    // A server not yet upgraded can still answer with the retired level; the
    // selector shows it as what it is rather than falling through to Private.
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        mode="create"
        visibility={ApiResourceVisibility.visibility_public}
        options={INSTANCE_VISIBILITY_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Resource visibility" });
    const publicRow = within(group).getByText("Public").closest("button");
    expect(publicRow?.getAttribute("aria-checked")).toBe("true");
    expect(publicRow?.textContent).toContain("Retired");

    fireEvent.click(screen.getByRole("radio", { name: /^Organization/i }));
    expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_org);
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

describe("VisibilitySelector — a locked row (consumer-supplied lockedReason)", () => {
  // The selector takes its options from the consumer, so a platform builder
  // can lock a level its caller may not enter; the component renders the
  // lock without knowing which level or why.
  const LOCKED_REASON = "Platform sharing is enabled by your workspace admin.";
  const LOCKED_LEVELS: readonly VisibilityLevelOption[] = BLUEPRINT_LEVELS.map(
    (level) =>
      level.value === ApiResourceVisibility.visibility_platform
        ? { ...level, lockedReason: LOCKED_REASON }
        : level,
  );

  it("renders the locked row non-interactive with the consumer's copy", () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        mode="create"
        visibility={ApiResourceVisibility.visibility_private}
        options={LOCKED_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    const lockedRow = screen.getByRole("radio", { name: /^Platform/i });
    expect((lockedRow as HTMLButtonElement).disabled).toBe(true);
    expect(lockedRow.getAttribute("aria-disabled")).toBe("true");
    expect(lockedRow.textContent).toContain(LOCKED_REASON);

    fireEvent.click(lockedRow);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps every other level selectable", () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        mode="create"
        visibility={ApiResourceVisibility.visibility_private}
        options={LOCKED_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /^Organization/i }));
    expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_org);
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
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("applies a de-escalation immediately, without confirmation", async () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_platform}
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

  it("requires the confirm dialog before escalating to Platform", async () => {
    const onChange = vi.fn();
    render(
      <VisibilitySelector
        visibility={ApiResourceVisibility.visibility_org}
        options={BLUEPRINT_LEVELS}
        onVisibilityChange={onChange}
      />,
    );

    await openPopover();
    fireEvent.click(optionByLabel("Platform"));

    // Not applied until the modal is confirmed.
    expect(onChange).not.toHaveBeenCalled();
    expect(await screen.findByText("Share with your whole platform?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make Platform" }));
    // The confirm resolves on a microtask, so the apply is asynchronous.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(ApiResourceVisibility.visibility_platform),
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
    fireEvent.click(optionByLabel("Platform"));
    await screen.findByText("Share with your whole platform?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Share with your whole platform?")).toBeNull(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("VisibilityBadge", () => {
  it("renders the human label for a visibility value", () => {
    render(<VisibilityBadge visibility={ApiResourceVisibility.visibility_platform} />);
    expect(screen.getByText("Platform")).toBeTruthy();
  });

  it("renders the retired public level by its own name, never as Private", () => {
    render(<VisibilityBadge visibility={ApiResourceVisibility.visibility_public} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.queryByText("Private")).toBeNull();
  });

  it("is non-interactive without onClick — a plain badge, not a button", () => {
    render(<VisibilityBadge visibility={ApiResourceVisibility.visibility_org} />);
    expect(screen.getByText("Organization")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders as an accessible Manage-access button when onClick is provided", () => {
    const onClick = vi.fn();
    render(
      <VisibilityBadge
        visibility={ApiResourceVisibility.visibility_org}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", {
      name: /Organization visibility — manage access/i,
    });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is keyboard-activatable when clickable (native button semantics)", () => {
    const onClick = vi.fn();
    render(
      <VisibilityBadge
        visibility={ApiResourceVisibility.visibility_private}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: /manage access/i });
    // A native <button type="button"> fires click on Enter/Space; assert the
    // element is the real thing rather than a div with a handler.
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });
});
