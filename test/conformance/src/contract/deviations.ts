// Spec-first known-deviation registry.
// Domain: conformance contract.
//
// The suite asserts the INTENDED contract, not whatever a given implementation
// happens to do today. Where a target legitimately deviates from the contract
// because of a known bug, it gets a tracked entry here instead of the test
// silently asserting the wrong behavior. When the target is fixed, the
// `observed` assertion in assertContractOrDeviation fails and the entry must
// be removed — the registry can never hide a regression or bless a bug
// permanently.
//
// A deviation is whatever the contract can state — a gRPC code, an HTTP
// status, a byte-pinned message, a visible side effect — so the registry
// records the two readings as prose and the arm supplies the two assertions.
// The first entries arrived when the hermetic Java launcher started running
// production security mode (entry 20260907.02): three behaviors of the Java
// service that the composition already answers per the contract.

export interface KnownDeviation {
  // Stable identifier used by tests to opt a case into the registry.
  id: string;
  // Target names that currently exhibit the deviation (TargetProfile.name).
  targets: string[];
  // What the contract requires, in one sentence.
  contract: string;
  // What the listed targets do instead, in one sentence.
  observed: string;
  // Why the deviation exists.
  rationale: string;
  // Where to fix it / track it.
  tracking: string;
}

// The hermetic Java targets. The Java service retires at R1; every entry
// naming them is deleted with it.
const JAVA_TARGETS = ["cloud", "cloud-execution"];

export const KNOWN_DEVIATIONS: KnownDeviation[] = [
  {
    id: "java.stripe-webhook.missing-signature-header-401",
    targets: JAVA_TARGETS,
    contract: "POST /webhook/stripe without a Stripe-Signature header answers 400 and grants nothing.",
    observed: "Java answers 401 (and still grants nothing).",
    rationale:
      "Spring MVC raises MissingRequestHeaderException → sendError(400) → Tomcat re-dispatches to " +
      "/error → HttpSecurityConfig's anyRequest().denyAll() refuses the anonymous caller → 401. Any " +
      "framework-generated 4xx on Java's HTTP lanes becomes a 401 for anonymous callers; the " +
      "controller's own ResponseEntity(400) paths are unaffected. Hidden under test security mode " +
      "(permit-all). Stripe always sends the header, so production never takes this path.",
    tracking:
      "stigmer-cloud entry 20260907.02, review finding F-A (cited, not filed — retires with Java; " +
      "the composition answers 400).",
  },
  {
    id: "java.direct-login.personal-org-owner-is-raw-subject",
    targets: JAVA_TARGETS,
    contract:
      "A first login's provisionMyAccount creates a personal organization OWNED BY the new identity " +
      "account, visible to it on findMyOrganizations.",
    observed:
      "Java's personal org is owned by the raw idp subject (identity_account:<sub>), so the new " +
      "account cannot see it and a retry cannot find it.",
    rationale:
      "EnsurePersonalOrganization calls organizationGrpcRepo.createAsCaller(org) while the caller is " +
      "still the unresolved subject (the interceptor admits an unknown human sub as its raw idpId), so " +
      "the org-create pipeline grants owner to that principal rather than the account it just created. " +
      "The composition fixed the same bug on its side (entry 20260905.01, Q8).",
    tracking:
      "stigmer-cloud#672 — an X1 input: whether production's FGA store (which survives the cutover) " +
      "holds raw-subject owner tuples is the first check.",
  },
  {
    id: "java.direct-login.stranger-signature-copy",
    targets: JAVA_TARGETS,
    contract:
      "A tenant-issuer token signed by a key the tenant's JWKS does not carry is refused " +
      'UNAUTHENTICATED "token signature verification failed".',
    observed: 'Java refuses UNAUTHENTICATED "invalid token" (the classifier fallback).',
    rationale:
      "GrpcSecurityConfigBase.classifyAuthError matches \"signature\", \"jwk\" or \"signing key\" in the " +
      "exception description; the runtime Nimbus message is \"Signed JWT rejected: Another algorithm " +
      "expected, or no matching key(s) found\" — none of those words. Java's own unit test fixture " +
      "carries an older message shape (\"… in JWK set\") that would match.",
    tracking:
      "stigmer-cloud entry 20260907.02, review finding F-D (cited, not filed — message copy only; " +
      "retires with Java; the composition answers the contract).",
  },
];

// Runs the contract assertion, or — for a target registered as deviating —
// the observed assertion, reporting the deviation (never silently). If a
// registered target starts meeting the contract, `observed` fails, signaling
// the entry is stale and should be deleted.
export async function assertContractOrDeviation(
  targetName: string,
  deviationId: string,
  assertions: {
    contract: () => Promise<void> | void;
    observed: () => Promise<void> | void;
  },
): Promise<void> {
  const deviation = KNOWN_DEVIATIONS.find((entry) => entry.id === deviationId);
  if (deviation === undefined) {
    throw new Error(`unknown deviation id: ${deviationId}`);
  }
  if (!deviation.targets.includes(targetName)) {
    await assertions.contract();
    return;
  }
  await assertions.observed();
  console.warn(
    `[conformance] tracked deviation ${deviation.id} on ${targetName}: ` +
      `contract="${deviation.contract}" observed="${deviation.observed}" (${deviation.tracking})`,
  );
}
