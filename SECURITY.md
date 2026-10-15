# Security policy

## Reporting a vulnerability

Please do not report a security vulnerability in a public issue, a pull
request, a discussion or on Discord.

Report it privately through GitHub instead:
[report a vulnerability](https://github.com/stigmer/stigmer/security/advisories/new)
(the repository's Security tab, then "Report a vulnerability"). Only the
maintainers can read it. Please include:

- the version and the component affected (the server, the runner, the CLI,
  an SDK, the Helm chart, `ee/`, ...);
- the steps to reproduce it, or a proof of concept;
- the impact as you understand it.

This applies to everything in this repository, the open-source code and the
Stigmer Enterprise code in `ee/` alike.

## What happens next

1. We acknowledge your report within 3 business days and tell you what
   happens next.
2. We confirm the problem and how far it reaches, and keep you told as the
   work goes on.
3. We fix it in a private security advisory. Nothing public describes the
   flaw before the release that fixes it.
4. We publish the advisory with that release, and credit you unless you ask
   us not to.

Please give us a reasonable time to ship the fix before you disclose it.

## Supported versions

| Version | Receives security fixes |
| --- | --- |
| The latest release | Yes |
| Any older release | No |

A security fix ships in a new release
([releases](https://github.com/stigmer/stigmer/releases)). To receive it,
upgrade to that release; for a self-hosted install, follow the Upgrade
section of the [operations guide](docs/guides/self-hosting/operations.mdx).
