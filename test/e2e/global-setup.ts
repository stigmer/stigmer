import * as fs from "node:fs";
import * as path from "node:path";
import { createNodeClient } from "@stigmer/sdk/node";
import {
  isPortReachable,
  startBackendStack,
  type ServerState,
} from "./fixtures/server-manager";
import { startMockLlmProxy } from "./fixtures/mock-llm";
import { ensureDefaultOrg } from "./fixtures/seed-helpers";
import {
  OIDC_AUDIENCE,
  OIDC_CONSOLE_CLIENT_ID,
  OIDC_ISSUER,
  OIDC_STACK,
  startIssuerProcess,
} from "./fixtures/oidc";
import { OAUTH_MCP_STACK, startOAuthMcpFixture } from "./fixtures/oauth-mcp";

const STATE_FILE = path.join(__dirname, ".e2e-server-state.json");
const API_PORT = Number(process.env.STIGMER_E2E_API_PORT ?? "7234");

// Opt-in deterministic LLM mode for the interactive-approval project. When set,
// the stack is booted with the mock LLM proxy wired into the runner; specs
// program canned responses over the proxy's HTTP control API. Off by default so
// the existing real-LLM interactive specs are untouched.
const MOCK_LLM =
  process.env.STIGMER_E2E_MOCK_LLM === "1" ||
  process.env.STIGMER_E2E_MOCK_LLM === "true";

// Opt-in FILE-GATE stack for the interactive-approval-gate project: the runner
// boots with ARTIFACT_STORAGE_TYPE=none, so a non-git session workspace has no
// capture substrate and file writes take the pre-execution approval gate (the
// deny-gate mode, DD-22) instead of flowing under apply-then-review. This is
// the only stack shape where the file-diff GATE card exists — the surface
// tool-card-ux.spec.ts pins. Requires the mock stack (a fresh boot).
const FILE_GATES =
  process.env.STIGMER_E2E_FILE_GATES === "1" ||
  process.env.STIGMER_E2E_FILE_GATES === "true";

async function globalSetup() {
  if (process.env.STIGMER_E2E_BASE_URL) {
    console.log(
      `[e2e] External target (${process.env.STIGMER_E2E_BASE_URL}) — skipping backend stack startup`,
    );
    return;
  }

  const alreadyRunning = await isPortReachable(API_PORT);

  // The OIDC stack shape (20260913.02 sp.console-login): the hermetic issuer
  // as a process, the server booted with STIGMER_OIDC_ISSUER pointed at it,
  // and NO seeded organization — the console-login spec asserts the
  // first-sign-in onboarding. A running trusted-local stack cannot be
  // reused: it would admit every request tokenless and prove nothing.
  if (OIDC_STACK) {
    if (alreadyRunning) {
      throw new Error(
        `[e2e] STIGMER_E2E_OIDC is set but a backend is already running on :${API_PORT}.\n` +
          `  The console-login suite needs a fresh stack in the OIDC posture.\n` +
          `  Stop the running stack (or set STIGMER_E2E_API_PORT to a free port) and retry.`,
      );
    }
    console.log(
      `[e2e] STIGMER_E2E_OIDC set — starting the hermetic OIDC issuer on ${OIDC_ISSUER}`,
    );
    const { child: issuer, ready } = await startIssuerProcess();
    if (ready.issuer !== OIDC_ISSUER) {
      issuer.kill();
      throw new Error(
        `[e2e] the issuer reported ${ready.issuer}, expected ${OIDC_ISSUER}`,
      );
    }
    console.log(
      `[e2e] Issuer ready (pid: ${issuer.pid}); signs in as ${ready.person.email}`,
    );
    const state = await startBackendStack({
      apiPort: API_PORT,
      extraServerEnv: {
        STIGMER_OIDC_ISSUER: OIDC_ISSUER,
        STIGMER_OIDC_AUDIENCE: OIDC_AUDIENCE,
        STIGMER_OIDC_CONSOLE_CLIENT_ID: OIDC_CONSOLE_CLIENT_ID,
      },
    });
    state.issuerPid = issuer.pid;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(
      "[e2e] Backend stack ready in the OIDC posture (no organization seeded on purpose)",
    );
    return;
  }

  // The OAuth MCP stack shape: the conformance harness's hosted OAuth MCP
  // server and its login server as one process, and the server booted with
  // the web dev server's callback page as its OAuth redirect, so the plugin
  // journey can sign in through a real popup. A running stack cannot be
  // reused: its redirect URI is not this origin's, and the fixture's URLs
  // are per run.
  if (OAUTH_MCP_STACK) {
    if (alreadyRunning) {
      throw new Error(
        `[e2e] STIGMER_E2E_OAUTH_MCP is set but a backend is already running on :${API_PORT}.\n` +
          `  The plugin sign-in arm needs a fresh stack booted with the console's OAuth callback.\n` +
          `  Stop the running stack (or set STIGMER_E2E_API_PORT to a free port) and retry.`,
      );
    }
    console.log("[e2e] STIGMER_E2E_OAUTH_MCP set — starting the OAuth MCP fixture");
    const { child: fixture, ready } = await startOAuthMcpFixture();
    console.log(
      `[e2e] OAuth MCP fixture ready (pid: ${fixture.pid}); MCP at ${ready.mcpUrl}, login server at ${ready.authorizationServer}`,
    );
    const baseURL = process.env.STIGMER_E2E_BASE_URL ?? "http://localhost:3000";
    const state = await startBackendStack({
      apiPort: API_PORT,
      extraServerEnv: {
        STIGMER_OAUTH_REDIRECT_URI: `${baseURL}/auth/oauth/callback`,
      },
    });
    state.oauthMcpPid = fixture.pid;
    state.oauthMcp = ready;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    const client = createNodeClient({
      baseUrl: `http://localhost:${API_PORT}`,
      getAccessToken: () => null,
    });
    await ensureDefaultOrg(client);
    console.log(`[e2e] Backend stack ready in the OAuth MCP shape; seeded "default" org`);
    return;
  }

  // In mock-LLM mode we MUST boot a fresh stack: a reused runner is not wired to
  // the proxy, so the approval specs would hit a real (or absent) model. Fail
  // fast with a clear remedy rather than silently testing the wrong thing.
  if (MOCK_LLM && alreadyRunning) {
    throw new Error(
      `[e2e] STIGMER_E2E_MOCK_LLM is set but a backend is already running on :${API_PORT}.\n` +
        `  The mock-LLM approval suite needs a fresh stack wired to the proxy.\n` +
        `  Stop the running stack (or set STIGMER_E2E_API_PORT to a free port) and retry.`,
    );
  }

  if (!MOCK_LLM && alreadyRunning) {
    console.log(`[e2e] Backend already running on :${API_PORT} — reusing`);
    const state: ServerState = { reused: true };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return;
  }

  if (FILE_GATES && !MOCK_LLM) {
    throw new Error(
      "[e2e] STIGMER_E2E_FILE_GATES requires STIGMER_E2E_MOCK_LLM — the file-gate " +
        "stack is a fresh mock-LLM boot (see `make test-e2e-approval`).",
    );
  }

  if (MOCK_LLM) {
    console.log(
      `[e2e] STIGMER_E2E_MOCK_LLM set — booting stack with deterministic mock LLM` +
        (FILE_GATES
          ? " (file-gate mode: no artifact store, writes gate pre-execution)"
          : ""),
    );
    const proxy = await startMockLlmProxy();
    const mockLlmEndpoint = proxy.url();
    const state = await startBackendStack({
      apiPort: API_PORT,
      mockLlmEndpoint,
      fileGates: FILE_GATES,
    });
    state.mockLlmControlUrl = mockLlmEndpoint;
    state.fileGateMode = FILE_GATES;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    // A fresh OSS stack has no organizations, so the web's OrgGate would block
    // every authenticated route on the onboarding screen. Seed the `default`
    // org (mirroring a first-run OSS user) so seeded sessions are reachable.
    const client = createNodeClient({
      baseUrl: `http://localhost:${API_PORT}`,
      getAccessToken: () => null,
    });
    await ensureDefaultOrg(client);

    console.log(
      `[e2e] Mock LLM proxy ready (control: ${mockLlmEndpoint}); seeded "default" org`,
    );
    return;
  }

  console.log(
    `[e2e] Backend not detected on :${API_PORT} — starting full stack`,
  );
  const state = await startBackendStack({ apiPort: API_PORT });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // Same rationale as the mock-LLM path above: a fresh OSS stack has no
  // organizations, so the web's OrgGate would park every functional spec
  // on the onboarding screen. Seeding here makes the suite deterministic
  // on fresh boots instead of depending on a long-lived dev backend.
  const client = createNodeClient({
    baseUrl: `http://localhost:${API_PORT}`,
    getAccessToken: () => null,
  });
  await ensureDefaultOrg(client);
  console.log(`[e2e] Seeded "default" org on the fresh stack`);
}

export default globalSetup;
