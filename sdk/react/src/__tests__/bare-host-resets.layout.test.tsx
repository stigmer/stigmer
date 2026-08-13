// Bare-host regression suite for the per-element UA resets (#695).
//
// Runs in a real Chromium via `vitest.a11y.config.ts` — the defect under
// guard is the user agent's OWN default list/fieldset/flow-content styling
// (bullets, 40px indents, stacked margins), which only a real browser
// applies. happy-dom has no UA stylesheet, so it would pass vacuously.
//
// The contract: every SDK component is authored against a zeroed-margin
// baseline (our consoles ship a global reset). In a host WITHOUT one —
// third-party embeds, the SDK's stated audience — UI lists and fieldsets
// carry the `UNSTYLED_LIST`/`UNSTYLED_FIELDSET` per-component resets
// (`internal/element-resets.ts` records why this class of reset cannot live
// in styles.css), and the markdown map declares its own top/inline margins.
// Like the sibling #374 suite (preflight-parity.layout.test.tsx), this
// renders against the SHIPPED stylesheet (`dist/styles.css`, rebuilt by
// `npm run build:css`) and nothing else — the page IS the bare host.
//
// Three directions, all load-bearing:
// 1. A control proving the harness is genuinely bare (a raw <ul> DOES show
//    UA bullets — if this fails, every other assertion here is vacuous).
// 2. The resets neutralize UA defaults on real, swept components.
// 3. Utilities and deliberate styling still win (markdown lists keep their
//    explicit bullets; spacing utilities compose on top of the reset).

import "../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import Markdown from "react-markdown";
import type { Stigmer } from "@stigmer/sdk";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerProvider } from "../provider";
import { TodoList } from "../execution/TodoList.js";
import { UNSTYLED_FIELDSET, UNSTYLED_LIST } from "../internal/element-resets.js";
import { MARKDOWN_COMPONENTS } from "../internal/markdown-components.js";

afterEach(cleanup);

// A minimal client (the preflight-parity suite's idiom): a null credential
// keeps the provider's registry fetches non-blocking so rendering is
// synchronous and never touches the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

function renderScoped(ui: React.ReactNode): HTMLElement {
  render(
    <StigmerProvider client={makeClient()}>
      <div data-testid="probe">{ui}</div>
    </StigmerProvider>,
  );
  return document.querySelector('[data-testid="probe"]') as HTMLElement;
}

function computed(el: Element): CSSStyleDeclaration {
  return getComputedStyle(el);
}

const ZERO_MARGINS = ["0px", "0px", "0px", "0px"];

function margins(style: CSSStyleDeclaration): string[] {
  return [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft];
}

describe("bare-host per-element resets (#695)", () => {
  it("CONTROL: the harness is genuinely bare — a raw <ul> wears UA bullets and indent", () => {
    const probe = renderScoped(
      <ul>
        <li>raw</li>
      </ul>,
    );
    const style = computed(probe.querySelector("ul")!);

    expect(style.listStyleType, "no global reset may leak into this page").toBe("disc");
    expect(style.paddingLeft, "UA padding-inline-start must be present").toBe("40px");
  });

  describe("UNSTYLED_LIST", () => {
    it("neutralizes bullets, indent, and margins", () => {
      const probe = renderScoped(
        <ul className={UNSTYLED_LIST}>
          <li>item</li>
        </ul>,
      );
      const style = computed(probe.querySelector("ul")!);

      expect(style.listStyleType).toBe("none");
      expect(style.paddingLeft).toBe("0px");
      expect(margins(style)).toEqual(ZERO_MARGINS);
    });

    it("spacing utilities still win over the reset (tailwind-merge + layer order)", () => {
      const probe = renderScoped(
        <ul className={`${UNSTYLED_LIST} stg:p-2`}>
          <li>item</li>
        </ul>,
      );

      expect(computed(probe.querySelector("ul")!).paddingLeft).toBe("8px");
    });

    it("a real swept organism (TodoList) renders without UA list styling", () => {
      const probe = renderScoped(
        <TodoList
          todos={{
            t1: create(TodoItemSchema, {
              id: "t1",
              content: "Scaffold the component",
              status: TodoStatus.TODO_IN_PROGRESS,
            }),
          }}
        />,
      );
      const style = computed(probe.querySelector('ul[aria-label="Tasks"]')!);

      expect(style.listStyleType).toBe("none");
      expect(style.paddingLeft).toBe("0px");
      expect(margins(style)).toEqual(ZERO_MARGINS);
    });
  });

  describe("UNSTYLED_FIELDSET", () => {
    it("neutralizes UA fieldset margins, padding, and min-inline-size", () => {
      const probe = renderScoped(
        <>
          <fieldset data-testid="raw">
            <legend>raw</legend>
          </fieldset>
          <fieldset data-testid="reset" className={UNSTYLED_FIELDSET}>
            <legend>reset</legend>
          </fieldset>
        </>,
      );

      // Control half: UA fieldset padding really is present in this page.
      expect(computed(probe.querySelector('[data-testid="raw"]')!).paddingLeft).not.toBe("0px");

      const style = computed(probe.querySelector('[data-testid="reset"]')!);
      expect(margins(style)).toEqual(ZERO_MARGINS);
      expect(style.paddingLeft).toBe("0px");
      expect(style.minWidth, "min-inline-size: min-content breaks flex shrinking").toBe("0px");
    });
  });

  describe("markdown map (content elements declare their own margins)", () => {
    function renderMarkdown(md: string): HTMLElement {
      return renderScoped(<Markdown components={MARKDOWN_COMPONENTS}>{md}</Markdown>);
    }

    it("paragraphs carry no UA top margin, so mb-* spacing is the whole rhythm", () => {
      const probe = renderMarkdown("first\n\nsecond");
      const [, second] = Array.from(probe.querySelectorAll("p"));

      expect(computed(second).marginTop).toBe("0px");
    });

    it("blockquotes lose the UA 1em/40px box but keep the authored border+padding treatment", () => {
      const probe = renderMarkdown("> quoted");
      const style = computed(probe.querySelector("blockquote")!);

      expect(style.marginTop).toBe("0px");
      expect(style.marginLeft, "UA margin-inline: 40px must be cleared").toBe("0px");
      expect(style.marginRight).toBe("0px");
      expect(style.paddingLeft, "the authored pl-4 treatment stays").toBe("16px");
    });

    it("content lists KEEP their bullets — the reset is for UI lists only", () => {
      const probe = renderMarkdown("- one\n- two");
      const style = computed(probe.querySelector("ul")!);

      expect(style.listStyleType).toBe("disc");
      expect(style.marginTop, "stacked UA margin-top must be cleared").toBe("0px");
      expect(style.paddingLeft, "authored pl-5 replaces the UA 40px").toBe("20px");
    });
  });
});
