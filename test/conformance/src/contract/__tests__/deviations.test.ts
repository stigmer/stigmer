// Unit arms for the known-deviation registry's two helpers: the deterministic
// one runs exactly one reading; the race one runs the contract everywhere and
// opens its path only for a registered target, only on an assertion failure,
// only when the observed reading PROVES the race — and re-tries the contract
// exactly once when the arm brings a remedy. Pure: no target.
// Domain: conformance contract.
import { ConnectError, Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertContractOrDeviation,
  assertContractOrKnownRace,
  KNOWN_DEVIATIONS,
  SUBMIT_APPROVAL_LOST_UPDATE_RACE,
} from "../deviations";

const DETERMINISTIC_ID = "java.direct-login.stranger-signature-copy";
const RACE_ID = SUBMIT_APPROVAL_LOST_UPDATE_RACE;
const RACE_TARGET = "cloud-execution";
const TS_TARGET = "local-execution";

// A failure the way vitest's expect produces one — the only kind that opens
// the race path.
function failAssertion(message: string): never {
  expect(false, message).toBe(true);
  throw new Error("unreachable");
}

describe("the registry", () => {
  it("names each race's retirement — a race entry cannot expire on its own", () => {
    for (const entry of KNOWN_DEVIATIONS) {
      if (entry.kind === "race") {
        expect(entry.retires, `${entry.id} says when it is deleted`).toMatch(/R1/);
      }
    }
  });

  it("refuses an unknown id and refuses an entry handed to the wrong helper", async () => {
    await expect(
      assertContractOrDeviation(TS_TARGET, "no.such.id", { contract: () => {}, observed: () => {} }),
    ).rejects.toThrow("unknown deviation id: no.such.id");
    await expect(
      assertContractOrDeviation(TS_TARGET, RACE_ID, { contract: () => {}, observed: () => {} }),
    ).rejects.toThrow(`deviation ${RACE_ID} is race, not deterministic; use assertContractOrKnownRace`);
    await expect(
      assertContractOrKnownRace(TS_TARGET, DETERMINISTIC_ID, { contract: () => {}, observed: () => {} }),
    ).rejects.toThrow(`deviation ${DETERMINISTIC_ID} is deterministic, not race; use assertContractOrDeviation`);
  });
});

describe("assertContractOrDeviation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs only the contract on an unregistered target", async () => {
    const contract = vi.fn();
    const observed = vi.fn();
    await assertContractOrDeviation(TS_TARGET, DETERMINISTIC_ID, { contract, observed });
    expect(contract).toHaveBeenCalledTimes(1);
    expect(observed).not.toHaveBeenCalled();
  });

  it("runs only the observed reading on a registered target and reports it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const contract = vi.fn();
    const observed = vi.fn();
    await assertContractOrDeviation("cloud", DETERMINISTIC_ID, { contract, observed });
    expect(contract).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`tracked deviation ${DETERMINISTIC_ID} on cloud`));
  });
});

describe("assertContractOrKnownRace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the contract alone on an unregistered target — a failure there is red, never a race", async () => {
    const observed = vi.fn();
    await expect(
      assertContractOrKnownRace(TS_TARGET, RACE_ID, {
        contract: () => failAssertion("the TS server met the contract"),
        observed,
      }),
    ).rejects.toThrow("the TS server met the contract");
    expect(observed).not.toHaveBeenCalled();
  });

  it("is silent on a registered target whose contract holds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observed = vi.fn();
    await assertContractOrKnownRace(RACE_TARGET, RACE_ID, { contract: () => {}, observed });
    expect(observed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("on a registered failure proves the race, reports one line, remedies, and re-asserts the contract once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    const observed = vi.fn();
    const remedy = vi.fn();
    await assertContractOrKnownRace(RACE_TARGET, RACE_ID, {
      contract: () => {
        attempts++;
        if (attempts === 1) failAssertion("pending still 1");
      },
      observed,
      remedy,
    });
    expect(attempts).toBe(2);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(remedy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`tracked race ${RACE_ID} on ${RACE_TARGET}`));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("remedy="));
  });

  it("fails the arm when the remedied contract fails again — never a second retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    await expect(
      assertContractOrKnownRace(RACE_TARGET, RACE_ID, {
        contract: () => {
          attempts++;
          failAssertion(`attempt ${attempts} failed`);
        },
        observed: () => {},
        remedy: () => {},
      }),
    ).rejects.toThrow("attempt 2 failed");
    expect(attempts).toBe(2);
  });

  it("without a remedy, the observed reading is the whole story", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    await assertContractOrKnownRace(RACE_TARGET, RACE_ID, {
      contract: () => {
        attempts++;
        failAssertion("closed, not timeout");
      },
      observed: () => {},
    });
    expect(attempts).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays red when the observed reading does not prove the race — an unknown symptom", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remedy = vi.fn();
    await expect(
      assertContractOrKnownRace(RACE_TARGET, RACE_ID, {
        contract: () => failAssertion("pending still 1"),
        observed: () => failAssertion("no decision in the stream either"),
        remedy,
      }),
    ).rejects.toThrow("no decision in the stream either");
    expect(remedy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets a non-assertion error through untouched — a ConnectError is not a race", async () => {
    const observed = vi.fn();
    await expect(
      assertContractOrKnownRace(RACE_TARGET, RACE_ID, {
        contract: () => {
          throw new ConnectError("unauthorized", Code.PermissionDenied);
        },
        observed,
      }),
    ).rejects.toBeInstanceOf(ConnectError);
    expect(observed).not.toHaveBeenCalled();
  });
});
