# Release hold

**Do not cut a release from `main` while this file exists.** `make release` and
the release procedure both refuse while it is here; a maintainer lifts the hold
by deleting this file in the pull request that lands the change named below, and
that pull request's review is the review of the lift.

## Why the next release waits

`main` carries an enforcing built-in authorizer for self-hosted servers that
sign users in through OIDC
([#1102](https://github.com/stigmer/stigmer/pull/1102) added organization roles,
[#1106](https://github.com/stigmer/stigmer/pull/1106) the list-scope half,
[#1111](https://github.com/stigmer/stigmer/pull/1111) the authorizer that reads
them and the first-boot role reconciliation). Open source must never ship roles
it does not enforce, so these had to land together, and they have.

What is still owed is the runner's side of that authorizer: the runner acting as
the run's human subject ([#1138](https://github.com/stigmer/stigmer/pull/1138)).
Without it, a self-host that upgrades with OIDC on and the Helm chart's
single-operator-key runner would see members' and scheduled runs unable to
report status, and every workflow that calls an agent refused when the runner
labels the child execution. A release between the two would ship that window.

## Lifting

Delete this file in the pull request that merges #1138 (or its successor), and
say in that release's notes that roles are assigned at the first start for
servers that ran an earlier version with OIDC on.
