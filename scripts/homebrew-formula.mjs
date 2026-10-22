#!/usr/bin/env node

/**
 * The one author of the Homebrew formula in stigmer/homebrew-tap
 * (`Formula/stigmer.rb`). reconcile-homebrew.yaml renders it here and pushes
 * the result; nothing edits the tap's copy by hand, so the words `brew info
 * stigmer` shows have one home and one test (homebrew-formula.test.mjs).
 *
 * The formula is the canonical Language::Node shape: Homebrew downloads the
 * @stigmer/cli tarball from npm, installs it (and its @stigmer/* deps) into
 * libexec, and links the `stigmer` launcher into bin. The server is fetched
 * on first use, so nothing else is bundled. The caveats say what the
 * quickstart says: the Anthropic key `stigmer setup` takes (the only provider
 * the local runner serves), then `stigmer up`. The tarball URL and its sha256
 * are inputs because npm's dist metadata carries only sha1 and sha512; the
 * workflow downloads the tarball and hashes it.
 *
 * DESC is audited by `brew style` (Homebrew's rubocops/shared/desc_helper.rb),
 * whose rules the test holds, so a wording `brew` would refuse fails here
 * before it reaches the tap.
 *
 * Usage (reconcile-homebrew.yaml):
 *   node scripts/homebrew-formula.mjs --tarball-url <url> --sha256 <hex> > Formula/stigmer.rb
 */

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** The one sentence fitted to Homebrew: no leading article, no full stop. */
export const DESC = "Open-source backend for the agents in your product";

export const HOMEPAGE = "https://stigmer.ai";

/** Where npm serves every @stigmer/cli tarball; the reconcile parses the version back out of it. */
const TARBALL_URL = /^https:\/\/registry\.npmjs\.org\/@stigmer\/cli\/-\/cli-[0-9A-Za-z.+-]+\.tgz$/;

/**
 * Renders Formula/stigmer.rb for one published @stigmer/cli tarball.
 *
 * @param {{ tarballUrl: string, sha256: string }} input
 * @returns {string}
 */
export function renderFormula({ tarballUrl, sha256 }) {
  if (!TARBALL_URL.test(tarballUrl)) {
    throw new Error(`not an @stigmer/cli tarball on npm: ${tarballUrl}`);
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`not a lowercase hex sha256: ${sha256}`);
  }
  return `require "language/node"

class Stigmer < Formula
  desc "${DESC}"
  homepage "${HOMEPAGE}"
  url "${tarballUrl}"
  sha256 "${sha256}"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~CAVEATS
      Agents run on your Anthropic key. Put it in your shell, then start
      Stigmer:

        export ANTHROPIC_API_KEY=<your Anthropic API key>
        stigmer up

      To save the key instead of exporting it each time, run \`stigmer setup\`
      once. The Stigmer server is downloaded on first use.
    CAVEATS
  end

  test do
    system "#{bin}/stigmer", "--version"
  end
end
`;
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: { "tarball-url": { type: "string" }, sha256: { type: "string" } },
    });
    process.stdout.write(renderFormula({ tarballUrl: values["tarball-url"] ?? "", sha256: values.sha256 ?? "" }));
  } catch (err) {
    console.error(`homebrew-formula: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
