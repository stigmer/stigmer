# Stigmer Enterprise

This directory holds Stigmer Enterprise: single sign-on through an
organization's own identity provider, many organizations, teams and
invitations, added to the open-source Stigmer server through its extension
points. The package is [`server/`](server/), published to npm as
`@stigmer/enterprise` and as a server image with the web console,
`ghcr.io/stigmer/stigmer-server-ee`.

## License

Everything under this directory is licensed under the
[Stigmer Enterprise License](LICENSE), not under the Apache License 2.0 that
covers the rest of this repository. In short, and the license text is what
binds: you may read, evaluate, modify and contribute to this code; running it
in production needs an agreement with Stigmer, Inc. and a license key it
issued. Without a key, the Enterprise server is the open-source server
exactly, and may run anywhere.

Nothing outside this directory imports from it, so the open-source server,
its libraries and its images contain no Enterprise code.

## Contributing

Contributions here are welcome under the terms in
[CONTRIBUTING.md](../CONTRIBUTING.md#license), which differ from the rest of
the repository's.
