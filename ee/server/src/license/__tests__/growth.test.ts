/**
 * Pins the freeze (license/growth.ts): growth is allowed through the term,
 * the expiring window and grace, and refused from the instant grace ends,
 * with FAILED_PRECONDITION, the LICENSE_RENEWAL_REQUIRED reason and the
 * renewal copy; the clock is read at every ask, so a server that is never
 * restarted still lapses, and the gate works as the chains' step. The
 * organization create chain's own step admits the server acting as itself
 * even once the license has lapsed, and asks the gate for everyone else.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import type { CallerIdentity } from "@stigmer/server";
import { RequestContext, serverActingFor } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { newGrowthGateStep } from "../../iam/growth-gate.js";
import {
  LICENSE_RENEWAL_MESSAGE,
  LICENSE_RENEWAL_REQUIRED,
  newLicenseGrowthGate,
  newOrganizationGrowthStep,
} from "../growth.js";
import { goldenVector } from "./test-tickets.js";

const golden = goldenVector();
const GRACE_ENDS = new Date("2027-10-22T10:00:00Z");

function refusalOf(act: () => void): ConnectError | undefined {
  try {
    act();
    return undefined;
  } catch (error) {
    return ConnectError.from(error);
  }
}

describe("newLicenseGrowthGate", () => {
  it.each([
    ["inside the term", new Date("2027-01-01T00:00:00Z")],
    ["inside the expiring window", new Date("2027-09-01T00:00:00Z")],
    ["inside grace", new Date("2027-10-01T00:00:00Z")],
    ["a millisecond before grace ends", new Date(GRACE_ENDS.getTime() - 1)],
  ])("allows growth %s", (_name, now) => {
    const gate = newLicenseGrowthGate({ claims: golden.claims, clock: () => now });
    expect(refusalOf(() => gate.assertGrowthAllowed())).toBeUndefined();
  });

  it("refuses growth from the instant grace ends, with the reason and the renewal copy", () => {
    const gate = newLicenseGrowthGate({ claims: golden.claims, clock: () => GRACE_ENDS });
    const refusal = refusalOf(() => gate.assertGrowthAllowed());
    expect(refusal?.code).toBe(Code.FailedPrecondition);
    expect(refusal?.rawMessage).toBe(LICENSE_RENEWAL_MESSAGE);
    expect(refusal?.findDetails(ErrorInfoSchema)[0]?.reason).toBe(LICENSE_RENEWAL_REQUIRED);
  });

  it("reads the clock at every ask, so a running server lapses when grace ends", () => {
    let now = new Date(GRACE_ENDS.getTime() - 1);
    const gate = newLicenseGrowthGate({ claims: golden.claims, clock: () => now });
    expect(refusalOf(() => gate.assertGrowthAllowed())).toBeUndefined();
    now = GRACE_ENDS;
    expect(refusalOf(() => gate.assertGrowthAllowed())?.code).toBe(Code.FailedPrecondition);
  });

  it("refuses through the chains' growth step", async () => {
    const step = newGrowthGateStep(
      newLicenseGrowthGate({ claims: golden.claims, clock: () => GRACE_ENDS }),
    );
    expect(step.name).toBe("GrowthGate");
    await expect((async () => step.execute({} as never))()).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
  });
});

describe("newOrganizationGrowthStep", () => {
  const person: CallerIdentity = {
    identityId: "ida_0123456789abcdefghjkmnpqrs",
    callerClass: "user",
    issuer: "https://sso.acme.example",
    rawToken: "t",
  };

  function creating(caller: CallerIdentity): RequestContext<typeof OrganizationSchema> {
    return new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { slug: "stigmer" } }),
      caller,
      ApiResourceKind.organization,
    );
  }

  function stepAt(now: Date) {
    return newOrganizationGrowthStep(newLicenseGrowthGate({ claims: golden.claims, clock: () => now }));
  }

  it("is named as the other chains' growth step", () => {
    expect(stepAt(GRACE_ENDS).name).toBe("GrowthGate");
  });

  it("admits the server acting as itself once the license has lapsed", async () => {
    await expect(stepAt(GRACE_ENDS).execute(creating(serverActingFor("system")))).resolves.toBeUndefined();
  });

  it("refuses a person once the license has lapsed, with the reason and the renewal copy", async () => {
    const step = stepAt(GRACE_ENDS);
    const refusal = await (async () => step.execute(creating(person)))().then(
        () => undefined,
        (error: unknown) => ConnectError.from(error),
      );
    expect(refusal?.code).toBe(Code.FailedPrecondition);
    expect(refusal?.rawMessage).toBe(LICENSE_RENEWAL_MESSAGE);
    expect(refusal?.findDetails(ErrorInfoSchema)[0]?.reason).toBe(LICENSE_RENEWAL_REQUIRED);
  });

  it("admits a person before grace ends", async () => {
    await expect(stepAt(new Date(GRACE_ENDS.getTime() - 1)).execute(creating(person))).resolves.toBeUndefined();
  });
});
