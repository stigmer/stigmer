# @stigmer/temporal-codecs

Temporal payload codecs shared by Stigmer's TypeScript Temporal processes:

- **`EncryptionPayloadCodec`** — AES-256-GCM encryption of payloads at rest
  in workflow history, with key-id-addressed rotation.
- **`ClaimcheckPayloadCodec`** — transparent offload of large payloads to
  blob storage (with optional gzip), replaced in history by a small marker.

## Why this is a library

The encryption envelope is a **cross-language wire contract**: the Java
decode-only codec in stigmer-cloud's `temporal-starter` must decrypt these
payloads byte-for-byte, and the Stigmer TypeScript server installs the same
codecs on its Temporal clients. One implementation, many consumers — the
contract must never fork. The committed fixture in
`src/__tests__/fixtures/encrypted-payload-fixture.json` pins the envelope;
never regenerate it casually (changing it means changing the cross-SDK
contract, which requires every implementation to move in lockstep).

Extracted from `backend/services/runner` (its `src/encryption/` and
`src/claimcheck/` modules) when the TypeScript server became the second
consumer.

## Consumers

- `@stigmer/runner` (`backend/services/runner`) — encode + decode on its
  Temporal workers.
- The Stigmer TypeScript server — decode for history reads, encode for
  payloads it writes.

## Dependency policy

`@temporalio/common` and `@temporalio/proto` are pinned **exact and
identical to the runner's pins** and must be bumped in lockstep with it:
the runner's consumer-install gate (stigmer/stigmer#786) fails on any
`@temporalio/*` version mix, because a split dependency tree registers the
Temporal core-sdk protobuf namespace twice and crashes worker init.

## Design notes

- The codecs perform no environment or secret reads of their own.
  `loadPayloadEncryptionConfig` takes an injected secret reader, so each
  consumer applies its own secret-custody policy (the runner routes reads
  through its boot-capture credential store; see stigmer/stigmer#508).
- The claim-check codec depends on the minimal `ClaimcheckStorage` port
  declared here — two methods, `upload` and `download` — which consumers
  satisfy structurally with their own storage clients.
