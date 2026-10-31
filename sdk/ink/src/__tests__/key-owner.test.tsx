// Pins the one-owner rule for the keyboard (app/key-owner.ts): a claim holds
// the keys while its surface is active, claims stack and let go in any order,
// and outside a provider the keys always read as free.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { Text } from "ink";
import { KeyOwnerProvider, useKeyClaim, useKeysFree } from "../app/key-owner.js";

afterEach(() => {
  cleanup();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function Claim({ active }: { readonly active: boolean }) {
  useKeyClaim(active);
  return null;
}

function Free() {
  return <Text>{useKeysFree() ? "free" : "claimed"}</Text>;
}

function Tree({ a, b }: { readonly a: boolean; readonly b: boolean }) {
  return (
    <KeyOwnerProvider>
      <Claim active={a} />
      <Claim active={b} />
      <Free />
    </KeyOwnerProvider>
  );
}

describe("the keyboard's owner", () => {
  it("is claimed while any surface holds it, and free once every claim let go, in any order", async () => {
    const { lastFrame, rerender } = render(<Tree a={false} b={false} />);
    await settle();
    expect(lastFrame()).toBe("free");
    rerender(<Tree a b={false} />);
    await settle();
    expect(lastFrame()).toBe("claimed");
    rerender(<Tree a b />);
    await settle();
    rerender(<Tree a={false} b />);
    await settle();
    expect(lastFrame()).toBe("claimed");
    rerender(<Tree a={false} b={false} />);
    await settle();
    expect(lastFrame()).toBe("free");
  });

  it("lets go when the surface unmounts, and reads free outside a provider", async () => {
    const { lastFrame, rerender } = render(
      <KeyOwnerProvider>
        <Claim active />
        <Free />
      </KeyOwnerProvider>,
    );
    await settle();
    expect(lastFrame()).toBe("claimed");
    rerender(
      <KeyOwnerProvider>
        <Free />
      </KeyOwnerProvider>,
    );
    await settle();
    expect(lastFrame()).toBe("free");
    cleanup();
    expect(
      render(
        <>
          <Claim active />
          <Free />
        </>,
      ).lastFrame(),
    ).toBe("free");
  });
});
