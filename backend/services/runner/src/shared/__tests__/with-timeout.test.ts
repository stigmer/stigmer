import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError } from "../with-timeout.js";

describe("withTimeout", () => {
  it("resolves with the function's result when it completes in time", async () => {
    const result = await withTimeout(1_000, "should not fire", async () => "done");
    expect(result).toBe("done");
  });

  it("rejects with the timeout message when the function hangs", async () => {
    const hang = () => new Promise<never>(() => {});
    await expect(
      withTimeout(20, "Cursor agent create timed out after 20ms", hang),
    ).rejects.toThrow("Cursor agent create timed out after 20ms");
  });

  it("rejects with a TimeoutError so callers can react to expiry by type", async () => {
    const hang = () => new Promise<never>(() => {});
    await expect(withTimeout(20, "expired", hang)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("does not wrap the function's own rejection in a TimeoutError", async () => {
    const boom = new Error("underlying failure");
    let caught: unknown;
    await withTimeout(1_000, "should not fire", () => Promise.reject(boom)).catch((err) => {
      caught = err;
    });
    expect(caught).toBe(boom);
    expect(caught).not.toBeInstanceOf(TimeoutError);
  });

  it("evaluates a lazy message only on expiry", async () => {
    let evaluated = 0;
    const message = () => {
      evaluated++;
      return "lazy timeout message";
    };

    await withTimeout(1_000, message, async () => "ok");
    expect(evaluated).toBe(0);

    const hang = () => new Promise<never>(() => {});
    await expect(withTimeout(20, message, hang)).rejects.toThrow("lazy timeout message");
    expect(evaluated).toBe(1);
  });

  it("propagates the function's own rejection unchanged", async () => {
    const boom = new Error("underlying failure");
    await expect(
      withTimeout(1_000, "should not fire", () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it("does not reject after a successful resolve (timer cleared)", async () => {
    const result = await withTimeout(20, "should not fire", async () => "fast");
    expect(result).toBe("fast");
    // If the timer leaked, the unhandled rejection would fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
});
