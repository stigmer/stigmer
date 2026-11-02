/**
 * `<Diagram name>`, the docs' tag for a drawing: it draws the drawing its
 * name holds, out of the docs body's prose styles, and refuses a name the
 * list does not hold; and each drawing's export text is the text the drawing
 * itself gives a reader who cannot see it, so the markdown exports cannot say
 * something the picture does not.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DIAGRAMS, diagram, isDiagramName, type DiagramName } from "@/components/visuals/diagrams";
import { Diagram } from "../diagram";

afterEach(cleanup);

const NAMES = Object.keys(DIAGRAMS) as DiagramName[];

/** The figure a diagram draws, inside its wrapper. */
function drawn(name: string): { wrapper: HTMLElement; figure: HTMLElement } {
  const { container } = render(<Diagram name={name} />);
  const wrapper = container.firstElementChild as HTMLElement;
  return { wrapper, figure: wrapper.querySelector("figure")! };
}

describe("Diagram", () => {
  it.each(NAMES)("draws %s as one figure, out of the docs body's prose styles", (name) => {
    const { wrapper, figure } = drawn(name);

    expect(wrapper.getAttribute("data-diagram")).toBe(name);
    expect(wrapper.className).toContain("not-prose");
    expect(figure).not.toBeNull();
    expect(wrapper.querySelectorAll("figure")).toHaveLength(1);
  });

  it("refuses a name the docs do not hold, naming the ones they do", () => {
    expect(isDiagramName("nope")).toBe(false);
    expect(isDiagramName("toString")).toBe(false);
    expect(() => render(<Diagram name="nope" />)).toThrow(/no diagram named "nope"; the docs draw "job-path"/);
  });
});

describe("a diagram's export text", () => {
  it.each(["job-path"] as const)("is %s's caption, word for word", (name) => {
    const { figure } = drawn(name);

    expect(figure.querySelector("figcaption")?.textContent).toBe(diagram(name).text);
  });
});
