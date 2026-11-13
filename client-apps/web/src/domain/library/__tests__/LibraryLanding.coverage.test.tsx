/**
 * Pins the web Library landing's Apply YAML, now in the page header: it
 * opens the apply dialog in the active organization, closed until pressed,
 * and an apply recounts every card (it can create any kind). The dialog and
 * the count hooks are pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

interface DialogProps {
  open: boolean;
  org: string;
  onApplied: () => void;
}

const page = vi.hoisted(() => ({
  dialog: [] as DialogProps[],
  tokens: [] as unknown[],
}));

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  const count = (_org: string | null, options: { refetchToken?: unknown }) => {
    page.tokens.push(options.refetchToken);
    return { count: 0, isLoading: false };
  };
  const allowed = () => ({ allowed: true, isLoading: false });
  return {
    Button: kit.Button,
    PageHeader: kit.PageHeader,
    ApplyManifestDialog: (props: DialogProps) => {
      page.dialog.push(props);
      return null;
    },
    ResourceCountCard: () => null,
    useAgentCount: count,
    useRoutineCount: count,
    useSkillCount: count,
    usePluginCount: count,
    useEnvironmentCount: count,
    useFileCount: count,
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: allowed,
    useCanCreateEnvironment: allowed,
    useCanCreateFile: allowed,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

import { LibraryLanding } from "../LibraryLanding";

beforeEach(() => {
  page.dialog.length = 0;
  page.tokens.length = 0;
});

describe("web LibraryLanding Apply YAML", () => {
  it("opens the apply dialog in the active org, and an apply recounts every card", () => {
    render(<LibraryLanding />);
    expect(page.dialog.at(-1)).toMatchObject({ open: false, org: "org_acme" });

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.dialog.at(-1)?.open).toBe(true);

    page.tokens.length = 0;
    act(() => page.dialog.at(-1)?.onApplied());
    expect(page.tokens).toHaveLength(6);
    expect(new Set(page.tokens)).toEqual(new Set([1]));
  });
});
