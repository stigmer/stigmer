// Spec-first known-deviation registry.
// Domain: conformance contract.
//
// The suite asserts the INTENDED contract, not whatever a given implementation
// happens to do today. Where a target legitimately deviates from the contract
// because of a known bug, it gets a tracked entry here instead of the test
// silently asserting the wrong behavior. A deviation is whatever the contract
// can state — a gRPC code, an HTTP status, a byte-pinned message, a visible
// side effect — so the registry records the two readings as prose and the arm
// supplies the two assertions.
//
// Two kinds, because two kinds of bug exist:
//
// - DETERMINISTIC: the target ALWAYS answers the observed reading. The arm runs
//   only the `observed` assertion there, so the day the target is fixed that
//   assertion fails and the entry must be deleted — the registry can never hide
//   a regression or bless a bug permanently. The first entries arrived when the
//   hermetic Java launcher started running production security mode (entry
//   20260907.02).
// - RACE: the target SOMETIMES answers the observed reading, on a timing it
//   does not control. The arm tries the contract first; only when that
//   assertion fails does it run the `observed` assertion, which must PROVE the
//   specific known race (a failure there is an unknown symptom and stays red),
//   report the firing on one grep-able line, and — where the entry names a
//   remedy — apply it and re-try the contract exactly once. A race entry cannot
//   self-expire (a fixed target simply stops firing), so it states when it is
//   deleted instead. The first entries arrived with the Class B lane-integrity
//   work (entry 20260908.01), which found the cloud-execution lane red on half
//   its runs for exactly this reason.
//
// What neither kind is: a retry budget, a sleep, or a skip. The contract
// assertion runs on every target every time; nothing here is reached unless
// the target is registered AND (for a race) the contract just failed.

interface DeviationRecord {
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

export interface DeterministicDeviation extends DeviationRecord {
  kind: "deterministic";
}

export interface RaceDeviation extends DeviationRecord {
  kind: "race";
  // What a production caller does when the race fires, in one sentence. The
  // arm supplies the act; the registry says why it is legitimate to perform
  // it inside a conformance run. Absent when the observed reading is final.
  remedy?: string;
  // When the entry is deleted, since it cannot expire on its own.
  retires: string;
}

export type KnownDeviation = DeterministicDeviation | RaceDeviation;

// The hermetic Java targets. The Java service retires at R1; every entry
// naming them is deleted with it.
const JAVA_TARGETS = ["cloud", "cloud-execution"];
// The Java execution target alone: races between the runner's status writes
// and a caller's RPC need a runner, so Class A never reaches them.
const JAVA_EXECUTION_TARGET = ["cloud-execution"];

// Race ids, exported so the one seam that applies each (support/agentexecutions.ts
// for the first; the two subscribe arms for the second) cannot drift from the
// registry by a typo.
export const SUBMIT_APPROVAL_LOST_UPDATE_RACE = "java.agentexecution.submit-approval.lost-update-race";
export const SUBSCRIBE_TRAILING_TERMINAL_WRITE_RACE = "java.execution-subscribe.trailing-terminal-write-closes";

export const KNOWN_DEVIATIONS: KnownDeviation[] = [
  {
    kind: "deterministic",
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
    kind: "deterministic",
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
    kind: "deterministic",
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
  {
    kind: "race",
    id: SUBMIT_APPROVAL_LOST_UPDATE_RACE,
    targets: JAVA_EXECUTION_TARGET,
    contract:
      "submitApproval's response reflects the decision synchronously — pending_approvals recomputed — " +
      "and the decided tool call carries its approval_action in the transcript for the rest of the run.",
    observed:
      "The decision survives in the approval-event stream but not in the transcript: either the " +
      "response still lists the tool call as pending and no Temporal signal fires (the response face), " +
      "or the response passes and the run completes with the tool call never decided in the transcript " +
      "(the audit face — five of the six approval reds on main, 2026-08-27 → 09-07).",
    rationale:
      "Both editions' workflows persist WAITING_FOR_APPROVAL a second time right before the signal " +
      "wait (byte-pinned: invoke-agent-execution.ts / InvokeAgentExecutionWorkflowImpl). Java's " +
      "UpdateStatusHandler reads the document for ApprovalFieldPreserver and later writes the whole " +
      "messages list with no lock spanning the two, so SubmitApproval's targeted $set landing in " +
      "between is lost; Java's own PendingApprovalProjector logs the divergence " +
      "(hitl_pending_approvals_projection_divergence, only-in-scan:<tool_call_id>). The OSS server's " +
      "submit is one read-modify-write under the store write lock with preserveApprovalFields inside " +
      "it, so the race is unreachable there. A caller that answers within ~10 ms of the gate — an SDK " +
      "or a bot, never a human — is the exposed population.",
    remedy:
      "Re-submit the same decision once — what a production approver does when the gate stays armed.",
    tracking:
      "stigmer-cloud#683 (a Java finding, retires with Java, an X1 input); the evidence table and Java " +
      "timelines in stigmer-cloud entry 20260908.01's tasks/T01_2_execution.md.",
    retires: "R1 — deleted with the Java targets; the OSS store lock makes the entry unreachable elsewhere.",
  },
  {
    kind: "race",
    id: SUBSCRIBE_TRAILING_TERMINAL_WRITE_RACE,
    targets: JAVA_EXECUTION_TARGET,
    contract:
      "A subscription opened on an already-terminal run receives the snapshot and is never closed by " +
      "the server (the pinned wave-2 S4 quirk: the terminal-close check fires only on broker updates).",
    observed:
      "Java sometimes closes it after delivering the terminal snapshot: the workflow's fallback persist " +
      "writes the terminal status a second time after the runner's own write, and that late broker " +
      "update trips the terminal-close check for a subscriber that arrived in between.",
    rationale:
      "The double terminal write is Java's; the OSS store serializes the same two writes so the " +
      "subscriber never sees a trailing update. The pin's purpose — the TS port reproducing the quirk " +
      "consciously — is served; whether the quirk should become a contract (close after a terminal " +
      "snapshot) is a separate ruling the entry raises and does not take.",
    tracking:
      "stigmer-cloud entry 20260908.01 — ten of the twenty-eight Class B reds in its evidence table; " +
      "stigmer#919.",
    retires: "R1 — deleted with the Java targets.",
  },
];

// Runs the contract assertion, or — for a target registered as deterministically
// deviating — the observed assertion, reporting the deviation (never silently).
// If a registered target starts meeting the contract, `observed` fails,
// signaling the entry is stale and should be deleted.
export async function assertContractOrDeviation(
  targetName: string,
  deviationId: string,
  assertions: {
    contract: () => Promise<void> | void;
    observed: () => Promise<void> | void;
  },
): Promise<void> {
  const deviation = lookupDeviation(deviationId, "deterministic");
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

// Runs the contract assertion on every target. On a target registered for the
// named race, an ASSERTION failure (and only that — any other error propagates)
// opens the race path: `observed` must hold, proving this is the known race and
// not a new symptom; the firing is reported on one line; if the arm supplies a
// remedy, it runs and the contract is asserted once more, this time for real.
export async function assertContractOrKnownRace(
  targetName: string,
  deviationId: string,
  assertions: {
    contract: () => Promise<void> | void;
    observed: () => Promise<void> | void;
    remedy?: () => Promise<void> | void;
  },
): Promise<void> {
  const race = lookupDeviation(deviationId, "race");
  try {
    await assertions.contract();
    return;
  } catch (err) {
    if (!race.targets.includes(targetName) || !isAssertionFailure(err)) throw err;
  }
  await assertions.observed();
  console.warn(
    `[conformance] tracked race ${race.id} on ${targetName}: ` +
      `contract="${race.contract}" observed="${race.observed}"` +
      (race.remedy !== undefined ? ` remedy="${race.remedy}"` : "") +
      ` (${race.tracking})`,
  );
  if (assertions.remedy !== undefined) {
    await assertions.remedy();
    await assertions.contract();
  }
}

function lookupDeviation<K extends KnownDeviation["kind"]>(
  deviationId: string,
  kind: K,
): Extract<KnownDeviation, { kind: K }> {
  const entry = KNOWN_DEVIATIONS.find((candidate) => candidate.id === deviationId);
  if (entry === undefined) {
    throw new Error(`unknown deviation id: ${deviationId}`);
  }
  if (entry.kind !== kind) {
    throw new Error(
      `deviation ${deviationId} is ${entry.kind}, not ${kind}; use ${helperFor(entry.kind)}`,
    );
  }
  return entry as Extract<KnownDeviation, { kind: K }>;
}

function helperFor(kind: KnownDeviation["kind"]): string {
  switch (kind) {
    case "deterministic":
      return "assertContractOrDeviation";
    case "race":
      return "assertContractOrKnownRace";
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled deviation kind ${String(exhaustive)}`);
    }
  }
}

// vitest's expect throws chai's AssertionError; a ConnectError, a timeout, or
// a thrown Error from the arm's own plumbing is not an assertion and must not
// open the race path.
function isAssertionFailure(err: unknown): boolean {
  return err instanceof Error && err.name === "AssertionError";
}