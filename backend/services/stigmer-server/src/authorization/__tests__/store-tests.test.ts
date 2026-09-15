/**
 * Runs the cloud's own OpenFGA store tests against the built-in
 * evaluator: the documents under fixtures/fga/ are pinned copies of
 * stigmer-cloud's `fga/tests/*.fga.yaml` (each header names its source
 * and commit), written by the model's authors and run against real
 * OpenFGA in the cloud's CI. Every `check` assertion on a kind this
 * edition declares must answer the same here — the proof that "the model
 * evaluated over derived tuples" means the SAME model.
 *
 * What is not run is reported, never dropped: an assertion on a kind not
 * yet declared (the remaining kinds follow) and every
 * `list_objects` assertion (the list scope's proof) come back
 * from the kit as a skipped set this file pins entry by entry, so a
 * fixture that gains a scenario, or a declaration that lands, is a
 * visible diff here and not a silently smaller proof.
 *
 * The cloud re-runs the LIVE documents through the same kit at the
 * re-pin (the drift test's second table), which is what makes the pinned
 * copies safe to hold.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { builtInModel } from "../model/index.js";
import type { StoreTestSkip } from "../store-test-kit.js";
import { parseStoreTestDocument, storeTestCases } from "../store-test-kit.js";

const FIXTURES = new URL("./fixtures/fga/", import.meta.url);

/** The documents this slice pins, by file name; a file added to the folder without a line here fails. */
const DOCUMENTS = [
  "blueprint-private-visibility.fga.yaml",
  "cross-org-share-creation.fga.yaml",
  "org-admin-owner-inheritance.fga.yaml",
] as const;

function skipLine(skip: StoreTestSkip): string {
  return `${skip.document} :: ${skip.test} :: ${skip.subject} ${skip.object} :: ${skip.reason}`;
}

/**
 * Every assertion the kit did not run, pinned. Kinds declared later
 * turn their lines here into run assertions; the list scope runs the
 * list_objects lines.
 */
const SKIPPED_PINNED: ReadonlyArray<string> = [
  "blueprint-private-visibility :: org admin's listable agents include private ones (T08) :: identity_account:oscar <agent> :: list-objects",
  "blueprint-private-visibility :: org member's listable agents exclude private ones (wildcard suppressed) :: identity_account:dave <agent> :: list-objects",
  "blueprint-private-visibility :: org viewer's listable agents are exactly the viewer-shaped org-visible ones :: identity_account:vera <agent> :: list-objects",
  "blueprint-private-visibility :: owner's listable agents include everything they authored :: identity_account:carol <agent> :: list-objects",
  "org-admin-owner-inheritance :: admin of an unrelated org has nothing :: identity_account:zara project:carols-project :: undeclared-kind",
  "org-admin-owner-inheritance :: admin's listable resources include private blueprints, never personal kinds :: identity_account:ana <agent> :: list-objects",
  "org-admin-owner-inheritance :: admin's listable resources include private blueprints, never personal kinds :: identity_account:ana <agent_instance> :: list-objects",
  "org-admin-owner-inheritance :: admin's listable resources include private blueprints, never personal kinds :: identity_account:ana <session> :: list-objects",
  "org-admin-owner-inheritance :: org admin inherits full management of every blueprint kind :: identity_account:ana agent_channel:carols-bot-slack :: undeclared-kind",
  "org-admin-owner-inheritance :: org admin inherits full management of every blueprint kind :: identity_account:ana agent_share:carols-bot-share :: undeclared-kind",
  "org-admin-owner-inheritance :: org admin inherits full management of every blueprint kind :: identity_account:ana channel_app:carols-slack-app :: undeclared-kind",
  "org-admin-owner-inheritance :: org admin inherits full management of every blueprint kind :: identity_account:ana project:carols-project :: undeclared-kind",
  "org-admin-owner-inheritance :: org admin inherits full management of every blueprint kind :: identity_account:ana schedule:carols-reminders :: undeclared-kind",
  "org-admin-owner-inheritance :: org owner inherits through the admin hierarchy :: identity_account:root agent_channel:carols-bot-slack :: undeclared-kind",
  "org-admin-owner-inheritance :: org owner inherits through the admin hierarchy :: identity_account:root agent_share:carols-bot-share :: undeclared-kind",
  "org-admin-owner-inheritance :: personal kinds stay admin-excluded (privacy invariant) :: identity_account:ana agent_instance:carols-instance :: undeclared-kind",
  "org-admin-owner-inheritance :: personal kinds stay admin-excluded (privacy invariant) :: identity_account:ana environment:carols-secrets :: undeclared-kind",
  "org-admin-owner-inheritance :: personal kinds stay admin-excluded (privacy invariant) :: identity_account:ana session:carols-chat :: undeclared-kind",
  "org-admin-owner-inheritance :: personal kinds stay admin-excluded (privacy invariant) :: identity_account:root environment:carols-secrets :: undeclared-kind",
  "org-admin-owner-inheritance :: plain org member still has nothing on private blueprints :: identity_account:dave agent_channel:carols-bot-slack :: undeclared-kind",
  "org-admin-owner-inheritance :: plain org member still has nothing on private blueprints :: identity_account:dave agent_share:carols-bot-share :: undeclared-kind",
  "org-admin-owner-inheritance :: plain org member still has nothing on private blueprints :: identity_account:dave channel_app:carols-slack-app :: undeclared-kind",
  "org-admin-owner-inheritance :: plain org member still has nothing on private blueprints :: identity_account:dave schedule:carols-reminders :: undeclared-kind",
];

describe("the cloud's OpenFGA store tests over the built-in evaluator", () => {
  it("the fixtures folder holds exactly the documents this file pins", () => {
    expect(
      readdirSync(FIXTURES)
        .filter((name) => name.endsWith(".fga.yaml"))
        .sort(),
    ).toEqual([...DOCUMENTS]);
  });

  const skipped: string[] = [];

  for (const name of DOCUMENTS) {
    const document = parseStoreTestDocument(
      yaml.load(readFileSync(fileURLToPath(new URL(name, FIXTURES)), "utf8")),
      name,
    );
    const kit = storeTestCases(document, builtInModel);
    skipped.push(...kit.skipped.map(skipLine));

    describe(document.name, () => {
      for (const storeTestCase of kit.cases) {
        it(storeTestCase.name, storeTestCase.run);
      }
    });
  }

  it("reports every assertion it did not run, and the list is the pinned one", () => {
    expect(skipped.sort()).toEqual([...SKIPPED_PINNED].sort());
  });
});
