// Pins the cloud global setup's refusal: a run with no declared environment,
// or one that hands over no direct-login tenant (the targets sign their
// people in through it), is refused before anything runs, naming every
// missing variable.
import { afterEach, describe, expect, it } from "vitest";

import { CLOUD_ENV } from "../cloud-env";
import setup from "../global-setup-cloud";

const NAMES = [CLOUD_ENV.address, CLOUD_ENV.token, CLOUD_ENV.directLoginIssuer];

describe("the cloud global setup", () => {
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("refuses a run whose environment hands over no direct-login tenant", async () => {
    process.env[CLOUD_ENV.address] = "http://127.0.0.1:1";
    process.env[CLOUD_ENV.token] = "t";
    delete process.env[CLOUD_ENV.directLoginIssuer];
    await expect(setup()).rejects.toThrow(CLOUD_ENV.directLoginIssuer);
  });

  it("accepts a declared environment", async () => {
    for (const name of NAMES) process.env[name] = "declared";
    const teardown = await setup();
    await teardown();
  });
});
