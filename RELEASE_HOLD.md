# Release hold

**Do not cut a release from `main` while this file exists.** `make release` and
the release procedure both refuse while it is here; a maintainer lifts the hold
by deleting this file in the pull request that lands the change named below, and
that pull request's review is the review of the lift.

## Why the next release waits

`main` carries the console's Marketplace page and Upload plugin
([#1176](https://github.com/stigmer/stigmer/pull/1176)). That change removes
`MarketplaceBrowser` and `MarketplaceBrowserProps` from `@stigmer/react` and
reshapes `PreparedInstall` in `@stigmer/plugin-package/client`, both published
in v3.17.0. The seedpack's deletion
([#1166](https://github.com/stigmer/stigmer/pull/1166)) must ship in the same
release: `stigmer seedpack`, `STIGMER_SEEDPACK_ORG` and the `@stigmer/seedpack`
package go, `stigmer bootstrap` and the official plugin catalogue replace them,
and an existing install's `assistant` is handed to the plugin in place on its
next `stigmer up`. Both changes are one story for the operator who upgrades, and
the notes tell it once; a release cut between them would ship the console's half
without the bootstrap it points at.

## Lifting

Delete this file in the pull request that merges #1166, and say in that
release's notes that `stigmer up` retires an older install's seedpack rows and
keeps its `assistant` agent.
