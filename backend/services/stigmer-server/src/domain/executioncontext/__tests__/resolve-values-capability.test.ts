/**
 * Pins the C4 authorizeExecutionContextRead capability arm of
 * resolveValuesForCaller (gate ruling Q1): when the composed provider
 * defines it, the capability IS the entire decrypt trust decision —
 * true decrypts, false redacts, and a THROWING capability falls closed
 * to redaction (redaction-as-success must survive a policy fault). The
 * OSS fallback arm (execution-scoped verify + binding equality) is
 * pinned by executioncontext.test.ts and the conformance suites; this
 * file covers only the delegation.
 */
import type { HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  EncryptionScope,
  SecretService,
} from "../../../encryption/encryption.js";
import { InvalidTokenError } from "../../../runnerauth/runnerauth.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { resolveValuesForCaller } from "../resolve-values-for-caller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const secretService = SecretService.create(Buffer.alloc(32, 7));

/** A minimal HandlerContext: the resolve path reads only the auth header. */
function ctxWithBearer(token: string): HandlerContext {
  const headers = new Headers();
  if (token !== "") {
    headers.set("authorization", `Bearer ${token}`);
  }
  return { requestHeader: headers } as unknown as HandlerContext;
}

function providerWith(
  authorize: (rawToken: string, executionId: string) => Promise<boolean>,
): RunnerCredentialProvider & { asked: Array<[string, string]> } {
  const asked: Array<[string, string]> = [];
  return {
    asked,
    isEnabled: () => false,
    mint: () => {
      throw new Error("mint is not under test");
    },
    verify: () => {
      // The capability path must never consult the primitive verify —
      // throwing here turns an accidental fallback into a test failure.
      throw new InvalidTokenError();
    },
    authorizeExecutionContextRead: (rawToken, executionId) => {
      asked.push([rawToken, executionId]);
      return authorize(rawToken, executionId);
    },
  };
}

async function executionContext() {
  return create(ExecutionContextSchema, {
    spec: {
      executionId: "aexec_cap1",
      data: {
        API_KEY: {
          value: await secretService.encrypt(
            "s3cret",
            EncryptionScope.forOrganization("test-org"),
          ),
          isSecret: true,
        },
      },
    },
  });
}

describe("resolveValuesForCaller (capability delegation — C4)", () => {
  it("decrypts when the capability answers true, passing token and execution id", async () => {
    const provider = providerWith(async () => true);
    const ec = await executionContext();
    await resolveValuesForCaller(
      { logger: silentLogger, secretService, runnerAuthService: provider },
      ctxWithBearer("sandbox-token"),
      ec,
    );
    expect(ec.spec?.data["API_KEY"]?.value).toBe("s3cret");
    expect(provider.asked).toEqual([["sandbox-token", "aexec_cap1"]]);
  });

  it("redacts when the capability answers false", async () => {
    const provider = providerWith(async () => false);
    const ec = await executionContext();
    await resolveValuesForCaller(
      { logger: silentLogger, secretService, runnerAuthService: provider },
      ctxWithBearer("someone-elses-token"),
      ec,
    );
    expect(ec.spec?.data["API_KEY"]?.value).toBe("***REDACTED***");
  });

  it("redacts without consulting the capability when no bearer token is presented", async () => {
    const provider = providerWith(async () => true);
    const ec = await executionContext();
    await resolveValuesForCaller(
      { logger: silentLogger, secretService, runnerAuthService: provider },
      ctxWithBearer(""),
      ec,
    );
    expect(ec.spec?.data["API_KEY"]?.value).toBe("***REDACTED***");
    expect(provider.asked).toEqual([]);
  });

  it("a THROWING capability falls closed to redaction — never a failed read", async () => {
    const provider = providerWith(async () => {
      throw new Error("policy backend unavailable");
    });
    const ec = await executionContext();
    await resolveValuesForCaller(
      { logger: silentLogger, secretService, runnerAuthService: provider },
      ctxWithBearer("sandbox-token"),
      ec,
    );
    expect(ec.spec?.data["API_KEY"]?.value).toBe("***REDACTED***");
  });
});
