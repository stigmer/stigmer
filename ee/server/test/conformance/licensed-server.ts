/**
 * A licensed Stigmer Enterprise server for the conformance suite: the
 * shipped entry's one `runServer` call (src/editions/enterprise-entry.ts),
 * with a license this process signs for itself and a ring that trusts only
 * the key it signed with.
 *
 * Why it exists. The shipped entry trusts only the keys compiled into the
 * package (src/license/trusted-keys.ts), with no configuration path on
 * purpose, so no test key can license it; the composed suites license a
 * server in-process with a ring of their own. The conformance suite drives
 * every edition as a process over the wire, so it spawns this file instead
 * (the `enterprise` target, test/conformance/src/targets/enterprise.ts at
 * the repository root). The signing key is made here, in memory, and dies
 * with the process: no key crosses a process boundary, and this server can
 * be licensed only as the composed suites already license theirs.
 *
 * Why here and not in src/. Everything under src/ is published as source;
 * a ready-made licensed entry there would ship in the package. This folder
 * is in no build, no tarball and no image. It runs from source under tsx
 * (`node --import tsx licensed-server.ts`), and its own tsconfig.json holds
 * it to the package's strict typecheck.
 *
 * Settings. Everything the shipped entry reads it reads the same way
 * (readEnterpriseSettings over the process env, with the signed key in
 * STIGMER_LICENSE_KEY's place), plus one test-only setting:
 * STIGMER_TEST_LICENSE_TERMS, a JSON object with any of `days` (the term,
 * default 365), `graceDays` (default 30), `maxOrgs` (absent: no limit) and
 * `issuedDaysAgo` (default 1). Unset, the license is current with no
 * organization limit; an `issuedDaysAgo` past `days` plus `graceDays` is a
 * lapsed one. An unknown field or a value that is not a whole number is
 * refused.
 *
 * A STIGMER_LICENSE_KEY in the environment refuses the boot: a real key
 * never meets a test ring by configuration. A refusal is reported on one
 * `boot failed:` line with exit code 1, as the shipped entry reports its
 * own.
 */
import { runServer } from "@stigmer/server";

import { composeEnterprise } from "../../src/editions/enterprise.js";
import { LICENSE_KEY_VARIABLE, readEnterpriseSettings } from "../../src/editions/enterprise-config.js";
import { licenseClaims, newTestSigner, writeTicket } from "../../src/license/__tests__/test-tickets.js";

/** The test-only setting this entry reads its license terms from. */
const TERMS_VARIABLE = "STIGMER_TEST_LICENSE_TERMS";

const DAY_MS = 24 * 60 * 60 * 1000;

interface LicenseTerms {
  readonly days: number;
  readonly graceDays: number;
  readonly maxOrgs: number | undefined;
  readonly issuedDaysAgo: number;
}

/** Each term with the least value it may take. */
const TERM_MINIMUMS = { days: 1, graceDays: 0, maxOrgs: 1, issuedDaysAgo: 0 } as const;

type TermName = keyof typeof TERM_MINIMUMS;

function isTermName(name: string): name is TermName {
  return Object.hasOwn(TERM_MINIMUMS, name);
}

/** The terms STIGMER_TEST_LICENSE_TERMS names, over the defaults; throws on anything it does not know. */
function readLicenseTerms(raw: string | undefined): LicenseTerms {
  const given: Partial<Record<TermName, number>> = {};
  if (raw !== undefined && raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${TERMS_VARIABLE} is not JSON`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${TERMS_VARIABLE} must be a JSON object`);
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (!isTermName(name)) {
        throw new Error(
          `${TERMS_VARIABLE} has an unknown field "${name}"; it takes ${Object.keys(TERM_MINIMUMS).join(", ")}`,
        );
      }
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < TERM_MINIMUMS[name]) {
        throw new Error(`${TERMS_VARIABLE}.${name} must be a whole number of at least ${TERM_MINIMUMS[name]}`);
      }
      given[name] = value;
    }
  }
  return {
    days: given.days ?? 365,
    graceDays: given.graceDays ?? 30,
    maxOrgs: given.maxOrgs,
    issuedDaysAgo: given.issuedDaysAgo ?? 1,
  };
}

async function main(): Promise<void> {
  if ((process.env[LICENSE_KEY_VARIABLE] ?? "").trim() !== "") {
    throw new Error(
      `${LICENSE_KEY_VARIABLE} is set, and this test server signs its own license: unset it, ` +
        "or boot the shipped entry (dist/main.js), which verifies a real key against the compiled keys",
    );
  }
  const terms = readLicenseTerms(process.env[TERMS_VARIABLE]);
  const signer = newTestSigner();
  const licenseKey = writeTicket(
    signer,
    licenseClaims({
      issuedAt: new Date(Date.now() - terms.issuedDaysAgo * DAY_MS),
      days: terms.days,
      graceDays: terms.graceDays,
      ...(terms.maxOrgs === undefined ? {} : { maxOrgs: terms.maxOrgs }),
    }),
  );
  // The shipped reading, as if the operator had pasted this key: the
  // Enterprise settings are read only beside a key.
  const settings = readEnterpriseSettings({ ...process.env, [LICENSE_KEY_VARIABLE]: licenseKey });
  await runServer({
    extensions: (boot) => composeEnterprise(boot, { ...settings, ring: signer.ring }),
  });
}

main().catch((error: unknown) => {
  console.error("boot failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
