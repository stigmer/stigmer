import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FileReferenceChipList } from "../FileReferenceChipList";

afterEach(cleanup);

describe("FileReferenceChipList", () => {
  it("returns null when refs array is empty", () => {
    const { container } = render(
      <FileReferenceChipList refs={[]} onRemove={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip for each ref path", () => {
    render(
      <FileReferenceChipList
        refs={["src/config.yaml", "docs/spec.md"]}
        onRemove={vi.fn()}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("aria-label")).toBe("Referenced file: src/config.yaml");
    expect(items[1].getAttribute("aria-label")).toBe("Referenced file: docs/spec.md");
  });

  it("displays the filename (last path segment) as visible text", () => {
    render(
      <FileReferenceChipList
        refs={["src/deeply/nested/file.ts"]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("file.ts")).toBeTruthy();
  });

  it("calls onRemove with the correct path when remove button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <FileReferenceChipList
        refs={["a.ts", "b.ts"]}
        onRemove={onRemove}
      />,
    );

    const items = screen.getAllByRole("listitem");
    const firstRemoveBtn = items[0].querySelector("button")!;
    fireEvent.click(firstRemoveBtn);

    expect(onRemove).toHaveBeenCalledWith("a.ts");
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("disables remove buttons when disabled prop is true", () => {
    render(
      <FileReferenceChipList
        refs={["a.ts"]}
        onRemove={vi.fn()}
        disabled
      />,
    );

    const item = screen.getByRole("listitem");
    const removeButton = item.querySelector("button")!;
    expect(removeButton.hasAttribute("disabled")).toBe(true);
  });

  it("renders with role=list and correct aria-label", () => {
    render(
      <FileReferenceChipList
        refs={["a.ts"]}
        onRemove={vi.fn()}
      />,
    );

    const list = screen.getByRole("list");
    expect(list.getAttribute("aria-label")).toBe("Referenced workspace files");
  });

  it("keeps the chip free of native titles — the full path rides the house tooltip", () => {
    render(
      <FileReferenceChipList
        refs={["src/deeply/nested/file.ts"]}
        onRemove={vi.fn()}
      />,
    );

    const item = screen.getByRole("listitem");
    expect(item.getAttribute("title")).toBeNull();
    // The basename stays visible; the full path is the tooltip's content
    // (reveal pinned in the real-browser suites).
    expect(item.textContent).toContain("file.ts");
  });
});
