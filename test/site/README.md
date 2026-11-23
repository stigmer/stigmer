# The built site

The browser suite of the public website (stigmer.ai: the docs, the blog, the
home page) as it is built. It serves the static export (`site/out`) the way the
site's host serves it and audits a sample of its pages with axe, at a phone
width and a desktop width, so an accessibility defect fails the pull request
that brings it rather than reaching the live site first. The layer and its rules
are in `test/README.md`, "The test standard".

## Run it

- `make test-site` builds the site, installs the workspace Playwright's
  Chromium, then runs the package's unit checks and the audit.
- With a build already in `site/out`, `npm run test:site -w @stigmer/site-tests`
  runs the same two without building, and `npx playwright test` in this folder
  runs the audit alone. Rebuild (`make -C site build`) after changing the site:
  the audit reads the export, never the source.

In CI the docs lane (`ci.docs.yaml`, `Lint & Build`) runs `test:site` right
after it builds the site, and uploads `test-results/` (each failing page's
trace) when it fails.

## What it audits

- `src/serve-out.ts` serves the export: the exact file, then `<path>.html`, then
  `<path>/index.html`, and an unknown path as `404.html` with status 404, which
  is how Cloudflare's `auto-trailing-slash` and `404-page` handling serve it in
  production (`site/wrangler.jsonc`). It is TypeScript that Node runs with no
  build; `src/__tests__/serve-out.test.ts` holds its rules.
- `tests/site.spec.ts` lists the pages in `PAGES`, each with why it is in the
  sample: one page per shape that has carried a defect or is likely to (code
  blocks, wide tables, a generated reference, the blog). The sample is not the
  site, so a defect on a page shape none of them has still ships unseen; when
  one does, its shape joins the list.
- Each page is opened at its clean URL in the config's two projects, `narrow`
  (390×844) and `wide` (1440×900). Every request that leaves the local server is
  aborted, so the audit never waits on the network: the site loads no
  third-party script, and the pages read exactly as built.
- The pages are audited at rest, with reduced motion. The site's reveal wrappers
  hold content at opacity 0 until it scrolls into view, and axe skips what it
  cannot see; under reduced motion the site's stylesheet shows every reveal
  still and whole (`site/src/components/ui/motion.tsx`).
- The audit judges by the policy the console's and the kit's audits share,
  `test/support/src/axe-policy.ts`: the WCAG 2.0 A and AA rules, and a critical
  or serious violation fails. The site has one colour mode, dark, so each page
  is audited once per width.

## The header's links

The same spec follows each of the header's Resources links from the home page
with a real click, at both widths: through the "Resources" menu at the desktop
width and through the navigation panel at the phone width. Playwright presses a
link only when the link is what a pointer would hit there, so a menu drawn under
the page's content fails the case (#3433: the menu opened under the hero, whose
headline took the clicks). A link added to `NAV_RESOURCES`
(`site/src/lib/constants.ts`) joins the spec's `RESOURCES` list.

## A violation the site already has

When the audit finds a critical or serious violation that is not your change's
to fix, file it as a stigmer issue (`site:` prefix: the rule, the page, the
width, the first elements) and list the rule in `KNOWN_VIOLATIONS` in
`tests/site.spec.ts`, keyed `"<path> <project>"`, against the issue. A listed
rule that still fails is reported and passes; one that no longer fails fails as
stale, so its line comes off in the fix's pull request. A rule is judged per
page, not per element, so when two issues share a rule on one page, list it once
for each: the page passes as known until both are fixed.

## Add a page

Add it to `PAGES` with why it is in the sample, run the audit, and list what it
finds as above. A path that is not in the export fails the audit with that
message.
