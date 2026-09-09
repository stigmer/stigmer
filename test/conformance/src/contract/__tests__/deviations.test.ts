// Unit arms for the known-deviation registry's two helpers: the deterministic
// one runs exactly one reading; the race one runs the contract everywhere and
// opens its path only for a registered IMPLEMENTATION, only on an assertion
// failure, only when the observed reading PROVES the race — and re-tries the
// contract exactly once when the arm brings a remedy. The registry keys on the
// implementation behind a target, never its name (stigmer#1012): the arms
// below drive the same "cloud" / "cloud-execution" names served by both.
// Pure: no live target — a two-field identity literal is the whole input.
// Domain: conformance contract.
import { ConnectError, Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertContractOrDeviation,
  assertContractOrKnownRace,
  KNOWN_DEVIATIONS,
  SUBMIT_APPROVAL_LOST_UPDATE_RACE,
} from "../deviations";
import { SERVER_IMPLEMENTATIONS, type TargetIdentity } from "../../targets/target";

const DETERMINISTIC_ID = "java.direct-login.stranger-signature-copy";
const RACE_ID = SUBMIT_APPROVAL_LOST_UPDATE_RACE;
// The Java service behind the cloud targets — the hermetic launcher's shape.
const JAVA_CLOUD: TargetIdentity = { name: "cloud", implementation: "stigmer-service" };
const JAVA_CLOUD_EXECUTION: TargetIdentity = { name: "cloud-execution", implementation: "stigmer-service" };
// The TypeScript composition behind the SAME target names — the readout's shape.
const COMPOSITION_CLOUD: TargetIdentity = { name: "cloud", implementation: "stigmer-server" };
const COMPOSITION_CLOUD_EXECUTION: TargetIdentity = { name: "cloud-execution", implementation: "stigmer-server" };
// The spawned TypeScript server on a local target.
const LOCAL_EXECUTION: TargetIdentity = { name: "local-execution", implementation: "stigmer-server" };

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

  it("keys every entry on at least one known implementation and never on a target name", () => {
    for (const entry of KNOWN_DEVIATIONS) {
      expect(entry.implementations.length, `${entry.id} names an implementation`).toBeGreaterThan(0);
      for (const implementation of entry.implementations) {
        expect(SERVER_IMPLEMENTATIONS, `${entry.id}: "${implementation}" is a server implementation`).toContain(
          implementation,
        );
      }
    }
  });

  it("holds only the Java service's bugs today — an entry naming the TypeScript server would be a contract question, not a deviation", () => {
    // The TS server is the reference implementation the contract is written
    // against; if it ever deviates, the fix is the server's or the contract's,
    // and this arm is where that decision surfaces first.
    for (const entry of KNOWN_DEVIATIONS) {
      expect(entry.implementations, entry.id).toEqual(["stigmer-service"]);
    }
  });

  it("refuses an unknown id and refuses an entry handed to the wrong helper", async () => {
    await expect(
      assertContractOrDeviation(LOCAL_EXECUTION, "no.such.id", { contract: () => {}, observed: () => {} }),
    ).rejects.toThrow("unknown deviation id: no.such.id");
    await expect(
      assertContractOrDeviation(LOCAL_EXECUTION, RACE_ID, { contract: () => {}, observed: () => {} }),
    ).rejects.toThrow(`deviation ${RACE_ID} is race, not deterministic; use assertContractOrKnownRace`);
    await expect(
      assertContractOrKnownRace(LOCAL_EXECUTION, DETERMINISTIC_ID, { contract: () => {}, observed: () => {} }),
    ).rejects.toThrow(`deviation ${DETERMINISTIC_ID} is deterministic, not race; use assertContractOrDeviation`);
  });
});

describe("assertContractOrDeviation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs only the contract on a local TypeScript target", async () => {
    const contract = vi.fn();
    const observed = vi.fn();
    await assertContractOrDeviation(LOCAL_EXECUTION, DETERMINISTIC_ID, { contract, observed });
    expect(contract).toHaveBeenCalledTimes(1);
    expect(observed).not.toHaveBeenCalled();
  });

  it("runs only the contract on the composition behind the `cloud` NAME — the name registers nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const contract = vi.fn();
    const observed = vi.fn();
    await assertContractOrDeviation(COMPOSITION_CLOUD, DETERMINISTIC_ID, { contract, observed });
    expect(contract).toHaveBeenCalledTimes(1);
    expect(observed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("runs only the observed reading on the Java service and reports the target with its implementation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const contract = vi.fn();
    const observed = vi.fn();
    await assertContractOrDeviation(JAVA_CLOUD, DETERMINISTIC_ID, { contract, observed });
    expect(contract).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledTimes(1);
    // The grep-able prefix readouts key on, then the implementation.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`tracked deviation ${DETERMINISTIC_ID} on cloud (stigmer-service)`),
    );
  });

  it("a Java service that starts meeting the contract fails the observed reading — the entry cannot outlive the bug", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      assertContractOrDeviation(JAVA_CLOUD, DETERMINISTIC_ID, {
        contract: () => {},
        observed: () => failAssertion("Java now answers the contract; delete the entry"),
      }),
    ).rejects.toThrow("delete the entry");
  });
});

describe("assertContractOrKnownRace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the contract alone on a local TypeScript target — a failure there is red, never a race", async () => {
    const observed = vi.fn();
    await expect(
      assertContractOrKnownRace(LOCAL_EXECUTION, RACE_ID, {
        contract: () => failAssertion("the TS server met the contract"),
        observed,
      }),
    ).rejects.toThrow("the TS server met the contract");
    expect(observed).not.toHaveBeenCalled();
  });

  it("is the contract alone on the composition behind the `cloud-execution` NAME — the race is Java's, not the name's", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observed = vi.fn();
    const remedy = vi.fn();
    await expect(
      assertContractOrKnownRace(COMPOSITION_CLOUD_EXECUTION, RACE_ID, {
        contract: () => failAssertion("pending still 1"),
        observed,
        remedy,
      }),
    ).rejects.toThrow("pending still 1");
    expect(observed).not.toHaveBeenCalled();
    expect(remedy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("is silent on a registered target whose contract holds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observed = vi.fn();
    await assertContractOrKnownRace(JAVA_CLOUD_EXECUTION, RACE_ID, { contract: () => {}, observed });
    expect(observed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("on a registered failure proves the race, reports one line, remedies, and re-asserts the contract once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    const observed = vi.fn();
    const remedy = vi.fn();
    await assertContractOrKnownRace(JAVA_CLOUD_EXECUTION, RACE_ID, {
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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`tracked race ${RACE_ID} on cloud-execution (stigmer-service)`));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("remedy="));
  });

  it("fails the arm when the remedied contract fails again — never a second retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    await expect(
      assertContractOrKnownRace(JAVA_CLOUD_EXECUTION, RACE_ID, {
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
    await assertContractOrKnownRace(JAVA_CLOUD_EXECUTION, RACE_ID, {
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
      assertContractOrKnownRace(JAVA_CLOUD_EXECUTION, RACE_ID, {
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
      assertContractOrKnownRace(JAVA_CLOUD_EXECUTION, RACE_ID, {
        contract: () => {
          throw new ConnectError("unauthorized", Code.PermissionDenied);
        },
        observed,
      }),
    ).rejects.toBeInstanceOf(ConnectError);
    expect(observed).not.toHaveBeenCalled();
  });
});
