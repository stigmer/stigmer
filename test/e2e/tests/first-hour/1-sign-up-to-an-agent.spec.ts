// A developer's first hour, step one: from nothing to the quickstart's
// agent, by the docs' "Stigmer Cloud" tab (docs/getting-started/quickstart.mdx).
//
// What it proves: a new person signs up through the console's sign-up door
// and lands signed in; the CLI signs them in through their own browser
// (`stigmer auth login`, its BROWSER handing the login page to the person's
// browser, where their console session is); the model key goes where the
// tab says; the CLI points at their Organization; and `stigmer apply`
// makes the agent from the page's file, which the server then holds as
// theirs. The tab's lines run as the page shows them, read from the page
// (test/install/lib/doc-steps.mjs, target "Stigmer Cloud"), so a renamed
// line on that tab turns this red before it merges. The page's run and
// download that follow are the getting-started smoke's
// (test/install/smoke-getting-started.mjs, on the machine's tab, with the
// same steps after this one); this journey's own run is the tool call.
//
// The lines the page names as the install's: the CLI's install lines (the
// CLI on PATH is the build under test, helpers/cli.ts) and the
// Organization's placeholder (`org-context`), which the person reads from
// the console's Organization, not types.
//
// Targets differ in two places, both named where they happen: a local
// target's CLI is pointed at its server by address before the tab's
// `stigmer auth login`, as a self-hosted reader does, where Stigmer Cloud is
// the CLI's own default; and a mock model needs no key, where a live one is
// saved in Models & providers as the tab says.
//
// Stack shape: STIGMER_E2E_OIDC=1 and STIGMER_E2E_MOCK_LLM=1 (`make
// test-e2e-first-hour`), or a deployed target (helpers/first-hour/target.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ListMyOrganizationsInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
// @ts-expect-error -- plain Node module without types, shared with the getting-started smoke
import { docSteps } from "../../../install/lib/doc-steps.mjs";
import { AGENT, expect, journeySkipReason, test } from "../../fixtures/first-hour";
import { expectCliSucceeded, signInFromCli } from "../../helpers/first-hour/steps";

const QUICKSTART = resolve(import.meta.dirname, "../../../../docs/getting-started/quickstart.mdx");

type DocStep =
  | { readonly kind: "file"; readonly path: string; readonly content: string }
  | { readonly kind: "command"; readonly line: string }
  | { readonly kind: "harness"; readonly line: string; readonly performs: string };

/** The tab's steps through `stigmer apply`: the agent made, the point this step ends. */
function cloudTabThroughApply(): DocStep[] {
  const steps = docSteps(readFileSync(QUICKSTART, "utf8"), { target: "Stigmer Cloud" }) as DocStep[];
  const apply = steps.findIndex((step) => step.kind === "command" && step.line === `stigmer apply -f ${AGENT}.yaml`);
  if (apply === -1) throw new Error(`the quickstart's Stigmer Cloud tab no longer applies ${AGENT}.yaml`);
  return steps.slice(0, apply + 1);
}

test.describe("a developer signs up and makes the quickstart's agent from its Stigmer Cloud tab", () => {
  test.skip(journeySkipReason() !== null, journeySkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("sign up, sign the CLI in through the browser, add the key, point at the Organization, apply the agent", async ({ journey }) => {
    journey.require("sign-up-to-an-agent");
    const { target, cli, page } = journey;
    const steps = cloudTabThroughApply();

    await test.step("signs up through the console's sign-up door and lands signed in", async () => {
      journey.found.email = await target.signUp(page);
      await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
    });

    if (target.cliBackend.kind === "address") {
      const { name, endpoint } = target.cliBackend;
      await test.step(`points the CLI at the server by address (${endpoint}), as a self-hosted reader does`, async () => {
        expectCliSucceeded(await cli.line(`stigmer config backend add ${name} --endpoint ${endpoint}`));
        expectCliSucceeded(await cli.line(`stigmer config backend use ${name}`));
      });
    }

    for (const step of steps) {
      if (step.kind === "harness" && step.performs === "cli") continue;
      if (step.kind === "file") {
        await test.step(`writes ${step.path} from the page`, async () => {
          writeFileSync(join(cli.workDir, step.path), step.content);
        });
      } else if (step.kind === "command" && step.line === "stigmer auth login") {
        await test.step("`stigmer auth login` signs in through the person's browser", async () => {
          const login = await signInFromCli(journey, step.line);
          expectCliSucceeded(login);
        });
        await test.step("adds the model key in Models & providers", async () => {
          if (target.model.kind === "mock") {
            // The mock model is the stack's runner's own: there is no key to add.
            test.info().annotations.push({ type: "target", description: "the mock model needs no key; a live target saves one here" });
            return;
          }
          await page.goto("/models");
          const card = page.getByRole("article", { name: target.model.provider });
          await card.getByRole("button", { name: `Connect ${target.model.provider}` }).click();
          await card.getByLabel(`${target.model.provider} API key`).fill(target.model.key);
          await card.getByRole("button", { name: `Connect ${target.model.provider}` }).click();
          await expect(card.getByText("Not connected", { exact: true })).toHaveCount(0, { timeout: 60_000 });
          await expect(card.getByLabel(`${target.model.provider} API key`)).toHaveCount(0);
        });
      } else if (step.kind === "harness" && step.performs === "org-context") {
        await test.step("points the CLI at the Organization the person signed up to", async () => {
          const person = await journey.asPerson();
          const [org] = (await person.organization.listMine(create(ListMyOrganizationsInputSchema, {}))).entries;
          const slug = org?.metadata?.slug ?? "";
          expect(slug, "the person has an Organization of their own").not.toBe("");
          journey.found.org = slug;
          expectCliSucceeded(await cli.line(step.line.replace("<your-org>", slug)));
        });
      } else if (step.kind === "command") {
        await test.step(`runs \`${step.line}\``, async () => {
          expectCliSucceeded(await cli.line(step.line));
        });
      } else {
        throw new Error(`the tab names a harness line this journey does not perform: ${step.line}`);
      }
    }

    await test.step("the server holds the agent as the person's", async () => {
      const person = await journey.asPerson();
      const agent = await person.agent.getByReference({ org: journey.found.org ?? "", slug: AGENT });
      expect(agent.metadata?.slug).toBe(AGENT);
    });
    journey.reach("sign-up-to-an-agent");
  });
});
