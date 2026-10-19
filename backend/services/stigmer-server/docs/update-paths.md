# What an update may change

An `update` names the resource it changes by `resource.metadata.id` and the fields it changes by `update_mask` (AIP-134). Every field the mask does not name keeps its stored value, and the change lands on the row as stored when it is written, so an update never undoes a change made since it read the resource. An update that carries the `metadata.etag` it read is refused with `ABORTED` and reason `ETAG_MISMATCH` when the resource changed since; one that carries none changes what it names. `apply` is an update that names every path (`*`). The rule is `checkUpdateMask` and `applyUpdateMask` in `src/pipeline/steps/update-mask.ts`.

This document is the inventory of the paths each kind's update refuses, one row per update the open-source server serves. It is held equal to the declarations beside each update chain (gathered in `src/domain/update-paths.ts`) by `src/domain/__tests__/update-paths-inventory.test.ts`, which also requires every spec field the contract marks `computed` to be refused by its kind.

## The rule

- **May be named**: `spec`, or any field under it at any depth through message fields; `metadata.name`, `metadata.labels` and `metadata.tags`; and `*`, every one of those. A path is the proto field names joined by dots (`spec.instructions`).
- **Replaced whole**: a list or a map at a named path. A path never goes through one.
- **Taken whenever set**: `metadata.version.message` and `metadata.version.tag`, which are a save's arguments, not stored state.
- **Refused with `INVALID_ARGUMENT` naming the path**: an empty mask, a path the kind does not have, a path through a list or a map, any other metadata path, and a path a kind refuses below. A refused field under a broader path (`spec`, `*`) is not refused: it keeps its stored value, so a whole desired state still applies.

Rows read `| Kind | refused path | written by |`, or `| Kind | none | |` for a kind that refuses no path of its own.

| Kind | Refused path | Written by |
|---|---|---|
| Agent | none | |
| ApiKey | `spec.key_hash` | the server, when the key is minted |
| ApiKey | `spec.fingerprint` | the server, when the key is minted |
| ApiKey | `spec.bound_org` | create |
| Channel | none | |
| ChannelApp | none | |
| Environment | none | |
| File | `spec.filename` | upload |
| File | `spec.mime_type` | upload |
| File | `metadata.name` | upload |
| IdentityAccount | none | |
| Memory | none | |
| OAuthApp | none | |
| Organization | `spec.policies` | updatePolicies |
| Organization | `spec.embedding` | updateEmbedding |
| Organization | `spec.parent_org` | create |
| Organization | `spec.external_id` | create |
| Routine | none | |
| Run | none | |
| Score | none | |
| ScoringRule | none | |
| Session | none | |
| Vault | `spec.secrets` | setSecrets and removeSecrets |
| Vault | `spec.connections` | a sign-in and removeConnections |
