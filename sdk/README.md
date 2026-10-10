# Stigmer SDKs

Typed clients for the Stigmer API, and the UI libraries the Stigmer Console is
built from. Every SDK talks to the same API, whose contract is the protobuf
definitions in [`apis/`](../apis/); each client is generated from it and wrapped
in the language's own idiom.

## API clients

| Language   | Package                                | Start here                                     |
| ---------- | -------------------------------------- | ---------------------------------------------- |
| TypeScript | `@stigmer/sdk`                         | [typescript/README.md](./typescript/README.md) |
| Go         | `github.com/stigmer/stigmer/sdk/go/v3` | [go/README.md](./go/README.md)                 |
| Python     | `stigmer`                              | [python/README.md](./python/README.md)         |
| Java       | `stigmer-java`                         | [java/README.md](./java/README.md)             |

Each client reaches every resource (Agents, Sessions, Runs, Vaults and the rest)
with the same operations, authenticates with an API key or a user token, and
reports refusals as typed errors.

## UI libraries (TypeScript)

| Package          | What it is                                                                     | Start here                           |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| `@stigmer/react` | The provider, hooks and components of the Console, embeddable in any React app | [react/README.md](./react/README.md) |
| `@stigmer/theme` | Design tokens, color presets and utilities for those components                | [theme/README.md](./theme/README.md) |
| `@stigmer/ink`   | Ink (React for terminals) components that render agent sessions                | [`ink/`](./ink/)                     |
| `@stigmer/embed` | A one-line `<stigmer-agent>` script embed for a shared Agent                   | [`embed/`](./embed/)                 |

## Reference docs

The reference for every resource, generated from the API, and each language's
guide are published at [stigmer.ai/docs/sdk](https://stigmer.ai/docs/sdk); their
sources are under [`docs/sdk/`](../docs/sdk/).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how each SDK is built and tested.
