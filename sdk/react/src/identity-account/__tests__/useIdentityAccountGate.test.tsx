/**
 * Pins the behaviour of `useIdentityAccountGate` — the console's first-sign-in
 * gate — so the hook can delegate its whoAmI → NOT_FOUND → provisionMyAccount
 * machine to `@stigmer/sdk`'s `ensureMyIdentityAccount` (20260911.11 A3)
 * without changing what any consumer observes. Written green against the
 * hook as it stood before the delegation; it must stay green after.
 *
 * The states and transitions it holds to:
 *
 *   checking ─ whoAmI answers ────────────────────────────▶ ready(account)
 *   checking ─ whoAmI NOT_FOUND ─▶ provisioning ─ answers ─▶ ready(account)
 *   checking ─ whoAmI other error ────────────────────────▶ error(message)
 *   provisioning ─ provisionMyAccount fails ──────────────▶ error(message)
 *   error ─ retry() ──────────────────────────────────────▶ checking (again)
 *   isEnabled: false ─────────────────────────────────────▶ ready (bypassed)
 *
 * and one invariant a delegation could silently break: a `retry()` issued
 * while an earlier attempt is in flight discards that attempt's outcome,
 * whichever RPC it was waiting on.
 */
import { Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { StigmerError } from "@stigmer/sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StigmerContext } from "../../context";
import { useIdentityAccountGate } from "../useIdentityAccountGate";

const EXISTING: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ida_existing" },
  spec: { idpId: "auth0|existing" },
});
const CREATED: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ida_created" },
  spec: { idpId: "auth0|created" },
});

const notFound = () =>
  new StigmerError(
    "not-found",
    "Identity account not found for the authenticated user",
    Code.NotFound,
  );

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Renders the gate and exposes its state via data attributes; click = retry. */
function GateProbe({ isEnabled }: { isEnabled: boolean }) {
  const { state, retry } = useIdentityAccountGate({ isEnabled });
  return (
    <button
      type="button"
      data-testid="probe"
      data-status={state.status}
      data-account={
        state.status === "ready" ? (state.account?.metadata?.id ?? "") : ""
      }
      data-message={state.status === "error" ? state.message : ""}
      onClick={retry}
    />
  );
}

function withClient(client: unknown, isEnabled = true) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <GateProbe isEnabled={isEnabled} />
    </StigmerContext.Provider>,
  );
}

const probe = () => screen.getByTestId("probe");
const status = () => probe().getAttribute("data-status");

afterEach(cleanup);

describe("useIdentityAccountGate", () => {
  it("checking → ready when whoAmI answers; provisionMyAccount is never called", async () => {
    const whoAmI = vi.fn(async () => EXISTING);
    const provisionMyAccount = vi.fn();
    withClient({ identityAccount: { whoAmI, provisionMyAccount } });

    expect(status()).toBe("checking");
    await waitFor(() => expect(status()).toBe("ready"));
    expect(probe().getAttribute("data-account")).toBe("ida_existing");
    expect(whoAmI).toHaveBeenCalledTimes(1);
    expect(provisionMyAccount).not.toHaveBeenCalled();
  });

  it("checking → provisioning → ready on NOT_FOUND (the first sign-in)", async () => {
    const provision = deferred<IdentityAccount>();
    const whoAmI = vi.fn(async () => {
      throw notFound();
    });
    const provisionMyAccount = vi.fn(() => provision.promise);
    withClient({ identityAccount: { whoAmI, provisionMyAccount } });

    await waitFor(() => expect(status()).toBe("provisioning"));
    expect(provisionMyAccount).toHaveBeenCalledTimes(1);

    provision.resolve(CREATED);
    await waitFor(() => expect(status()).toBe("ready"));
    expect(probe().getAttribute("data-account")).toBe("ida_created");
  });

  it("any other whoAmI error is the error state with its message; no provisioning", async () => {
    const whoAmI = vi.fn(async () => {
      throw new StigmerError(
        "unauthenticated",
        "token expired",
        Code.Unauthenticated,
      );
    });
    const provisionMyAccount = vi.fn();
    withClient({ identityAccount: { whoAmI, provisionMyAccount } });

    await waitFor(() => expect(status()).toBe("error"));
    expect(probe().getAttribute("data-message")).toBe("token expired");
    expect(provisionMyAccount).not.toHaveBeenCalled();
  });

  it("a provisioning failure is the error state with the provisioner's message", async () => {
    const whoAmI = vi.fn(async () => {
      throw notFound();
    });
    const provisionMyAccount = vi.fn(async () => {
      throw new StigmerError(
        "unavailable",
        "userinfo answered 503",
        Code.Unavailable,
      );
    });
    withClient({ identityAccount: { whoAmI, provisionMyAccount } });

    await waitFor(() => expect(status()).toBe("error"));
    expect(probe().getAttribute("data-message")).toBe("userinfo answered 503");
  });

  it("retry() from error restarts at checking and can reach ready", async () => {
    let calls = 0;
    const whoAmI = vi.fn(async () => {
      calls += 1;
      if (calls === 1)
        throw new StigmerError("unavailable", "warming up", Code.Unavailable);
      return EXISTING;
    });
    withClient({ identityAccount: { whoAmI } });

    await waitFor(() => expect(status()).toBe("error"));
    fireEvent.click(probe());
    await waitFor(() => expect(status()).toBe("ready"));
    expect(probe().getAttribute("data-account")).toBe("ida_existing");
    expect(whoAmI).toHaveBeenCalledTimes(2);
  });

  it("a retry while whoAmI is in flight discards the earlier attempt's answer", async () => {
    const first = deferred<IdentityAccount>();
    const second = deferred<IdentityAccount>();
    const answers = [first.promise, second.promise];
    const whoAmI = vi.fn(() => answers.shift()!);
    withClient({ identityAccount: { whoAmI } });

    await waitFor(() => expect(whoAmI).toHaveBeenCalledTimes(1));
    fireEvent.click(probe());
    await waitFor(() => expect(whoAmI).toHaveBeenCalledTimes(2));

    // `act` flushes React's work, so a stale setState would be visible here.
    await act(async () => {
      first.resolve(EXISTING);
    });
    expect(status(), "the stale attempt must not settle the gate").toBe(
      "checking",
    );

    second.resolve(CREATED);
    await waitFor(() => expect(status()).toBe("ready"));
    expect(probe().getAttribute("data-account")).toBe("ida_created");
  });

  it("a retry while provisioning is in flight discards the earlier attempt's outcome", async () => {
    const provision = deferred<IdentityAccount>();
    let whoAmICalls = 0;
    const whoAmI = vi.fn(async () => {
      whoAmICalls += 1;
      if (whoAmICalls === 1) throw notFound();
      return EXISTING;
    });
    const provisionMyAccount = vi.fn(() => provision.promise);
    withClient({ identityAccount: { whoAmI, provisionMyAccount } });

    await waitFor(() => expect(status()).toBe("provisioning"));
    fireEvent.click(probe());
    await waitFor(() => expect(status()).toBe("ready"));
    expect(probe().getAttribute("data-account")).toBe("ida_existing");

    // The abandoned provisioning settles late; the gate keeps the second
    // attempt's answer.
    await act(async () => {
      provision.reject(
        new StigmerError("unavailable", "late failure", Code.Unavailable),
      );
    });
    expect(status()).toBe("ready");
    expect(probe().getAttribute("data-account")).toBe("ida_existing");
  });

  it("isEnabled: false bypasses the gate — ready at once, no RPC", async () => {
    const whoAmI = vi.fn(async () => EXISTING);
    withClient({ identityAccount: { whoAmI } }, false);

    expect(status()).toBe("ready");
    await act(async () => {});
    expect(whoAmI).not.toHaveBeenCalled();
  });
});
