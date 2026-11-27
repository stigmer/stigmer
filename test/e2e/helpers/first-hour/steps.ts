// The first-hour journey's shared acts: what more than one of its steps does
// the same way, kept once (tests/first-hour).
//
// The proof every tool step shares: the step sends a fresh nonce, and the
// tool's RESULT carries it (the fixture's `echo` answers its `text`). On the
// mock the call is scripted with the nonce and the model's own words never
// hold it, so only the tool can have put it there; against a live model the
// message asks for the call with the nonce, and the result is read the same
// way. A screen appearing, or the model saying it called something, is never
// the proof.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import { CreateServiceAccountInputSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/io_pb";
import { CreateServiceAccountKeyInputSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import { UpdateOrganizationEmbeddingInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { AGENT, TOOL, TOOL_AS_CALLED, TOOL_SERVER, type Journey } from "../../fixtures/first-hour";
import type { CliResult } from "../cli";
import { MockControl } from "../mock-llm-control";
import type { JourneyModel, JourneyToolServer } from "./target";

/** Fails naming the command and what it printed, unless it exited 0. */
export function expectCliSucceeded(result: CliResult): void {
  expect(result.status, `\`${result.line}\` exited ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
}

/** A value no screen, script or model could hold before this step made it. */
export function nonce(step: string): string {
  return `${step}-${randomBytes(6).toString("hex")}`;
}

/** What the person asks the agent: the call to `server`'s tool, with the nonce, in words a live model acts on. */
export function askForTheTool(value: string, server: string = TOOL_SERVER): string {
  return `Call the ${TOOL} tool of ${server} with the text "${value}", then say that you did.`;
}

/**
 * Readies the model for one turn that calls the tool with `value`: on the
 * mock, the call (by the name a turn gives it: the plugin's by default) and
 * then a reply that does not repeat the value; a live model needs nothing.
 */
export async function scriptToolCall(model: JourneyModel, value: string, callId: string, toolName: string = TOOL_AS_CALLED): Promise<void> {
  if (model.kind !== "mock") return;
  const control = new MockControl(model.controlUrl);
  await control.reset();
  await control.enqueue(anthropicToolUses([{ toolCallId: callId, toolName, toolInput: { text: value } }]));
  await control.enqueue(anthropicText("Done: the tool answered."));
}

/** Drops whatever the mock still holds, so a step that ended early leaves nothing for the next. */
export async function resetModel(model: JourneyModel): Promise<void> {
  if (model.kind === "mock") await new MockControl(model.controlUrl).reset();
}

/**
 * Lets the turn that called the tool finish on the mock (its script served
 * whole, so no run is left asking for a turn the next step scripts), then
 * clears it. With `served` false the run never reached the model, and the
 * script is cleared at once.
 */
export async function drainModel(model: JourneyModel, served = true): Promise<void> {
  if (model.kind !== "mock") return;
  const control = new MockControl(model.controlUrl);
  if (served) await expect.poll(() => control.remaining(), { timeout: 60_000, message: "the turn takes its whole script" }).toBe(0);
  await control.reset();
}

/**
 * The state the embedding tutorial's earlier pages leave, made through the
 * API as the person: the `report-backend` service account (or `account`,
 * for a second app) with a key of its own, and account creation on in the
 * embedding settings with the member role. Returns the key, the tutorial's
 * STIGMER_API_KEY.
 */
export async function prepareEmbedding(journey: Journey, account = "report-backend"): Promise<string> {
  const person = await journey.asPerson();
  const org = journey.found.org ?? "";
  const created = await person.identityAccount.createServiceAccount(
    create(CreateServiceAccountInputSchema, { org, name: account, role: IamRole.admin }),
  );
  const key = await person.apiKey.createForServiceAccount(
    create(CreateServiceAccountKeyInputSchema, { serviceAccountId: created.metadata?.id ?? "", name: account, neverExpires: true }),
  );
  await person.organization.updateEmbedding(
    create(UpdateOrganizationEmbeddingInputSchema, { orgId: org, embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member } }),
  );
  const apiKey = key.spec?.keyHash ?? "";
  expect(apiKey, "the service account's key").not.toBe("");
  return apiKey;
}

/**
 * The CLI line that signs in through the browser (`stigmer auth login`):
 * each address it opens is opened in the person's browser, where their
 * console session is, and answered as the target's login page asks, until
 * it hands the CLI its sign-in at the CLI's own loopback address.
 */
export async function signInFromCli(journey: Journey, line: string): Promise<CliResult> {
  return journey.cli.line(line, {
    timeoutMs: 120_000,
    onBrowser: async (url) => {
      const login = await journey.context.newPage();
      try {
        await login.goto(url);
        await journey.target.consentToCli?.(login);
        await login.waitForURL((at) => at.hostname === "127.0.0.1" || at.hostname === "localhost", { timeout: 60_000 });
      } finally {
        await login.close();
      }
    },
  });
}

/**
 * Adds the tool server as the console adds one ("Add MCP server": a plugin
 * of that one server, named for it), and waits for its page to offer the
 * sign-in its install found it needs.
 */
export async function addToolServer(page: Page, toolServer: JourneyToolServer): Promise<void> {
  await page.goto("/library/plugins?add=mcp-server");
  const add = page.getByRole("dialog", { name: "Add MCP server" });
  await expect(add).toBeVisible({ timeout: 30_000 });
  await add.getByLabel("Name").fill(TOOL_SERVER);
  await add.getByLabel("URL").fill(toolServer.mcpUrl);
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${TOOL_SERVER}$`), { timeout: 60_000 });
  await expect(page.getByRole("button", { name: `Sign in to ${TOOL_SERVER}` })).toBeVisible({ timeout: 30_000 });
}

/**
 * Lists the plugin in the agent's file and applies it again, as a developer
 * does from their editor: `plugins:` under `spec:`, and, when only an agent
 * with a computer reaches the tool server (one on this machine), the
 * computer it needs.
 */
export async function listPluginInAgentFile(journey: Journey, toolServer: JourneyToolServer): Promise<void> {
  const file = join(journey.cli.workDir, `${AGENT}.yaml`);
  const before = readFileSync(file, "utf8");
  expect(before, `${AGENT}.yaml is the quickstart's, with its spec last`).toMatch(/^spec:\n/m);
  const lines = [
    "  plugins:",
    "    - kind: plugin",
    `      slug: ${TOOL_SERVER}`,
    ...(toolServer.reach === "loopback" ? ["  computer: COMPUTER_REQUIRED"] : []),
  ];
  writeFileSync(file, `${before.trimEnd()}\n${lines.join("\n")}\n`);
  expectCliSucceeded(await journey.cli.line(`stigmer apply -f ${AGENT}.yaml`));
}

/** A tool-call row of the kit's conversation timeline. */
export function toolCallRows(scope: Page | Locator): Locator {
  return scope.locator('[data-cursor-target="tool-call-row"]');
}

/**
 * Waits for the conversation to show the tool's call whose result carries
 * `value`: the row of the call, opened to what it returned. The model's
 * own reply is never read.
 */
export async function expectToolResultInTimeline(scope: Page | Locator, value: string, timeout = 120_000): Promise<void> {
  // A finished turn keeps its calls one click away, under "How it got there";
  // the rows are read once the turn has finished, so none re-renders under
  // the click.
  const howItGotThere = turnSummary(scope);
  await expect(howItGotThere, `the turn finishes having used a tool`).toBeVisible({ timeout });
  if ((await howItGotThere.getAttribute("aria-expanded")) !== "true") await howItGotThere.click({ timeout: 30_000 });
  const row = toolCallRows(scope).filter({ hasText: TOOL }).first();
  await expect(row, `a call to ${TOOL} shows in the conversation`).toBeVisible({ timeout: 30_000 });
  await row.click({ timeout: 30_000 });
  // The opened row lists the call's input and what the tool returned, each
  // under its own term; the input holds the nonce too, so only the term
  // `result` is read.
  const result = row.getByRole("term").filter({ hasText: /^result$/ }).locator("xpath=following-sibling::*[1]");
  await expect(result, `the ${TOOL} call's result carries the step's nonce`).toContainText(value, { timeout: 30_000 });
}

/** The line a finished turn that used tools leads its work with ("How it got there: used 1 tool"). */
export function turnSummary(scope: Page | Locator): Locator {
  return scope.getByRole("button", { name: /^How it got there: used/ }).last();
}

/**
 * Waits for a send to start a conversation (the console's address moves to
 * it); a send the console refuses fails naming the notice it showed, never
 * a timeout on the address.
 */
export async function expectConversationStarted(page: Page): Promise<void> {
  const notice = page.locator("[data-sonner-toast]").first();
  const started = page.waitForURL(/\/sessions\/ses_/, { timeout: 60_000 }).then(() => null);
  const refused = notice.waitFor({ state: "visible", timeout: 60_000 }).then(async () => (await notice.innerText()).trim());
  const outcome = await Promise.race([started, refused.catch(() => new Promise<never>(() => undefined))]);
  if (outcome !== null) throw new Error(`the console did not start the conversation; it said: ${outcome}`);
}
