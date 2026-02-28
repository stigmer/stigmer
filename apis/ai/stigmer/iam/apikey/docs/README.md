# ApiKey Resource Documentation

Comprehensive documentation for the `iam.stigmer.ai/v1` ApiKey resource.

## What Is an ApiKey?

An ApiKey is a credential that any authenticated Stigmer user or machine account can create to authenticate API requests programmatically. Instead of passing a short-lived JWT on every request, a client presents a long-lived API key that the backend verifies by checking its stored hash.

The raw key value is returned **only once** — in the create response. Stigmer never stores the raw key; it stores a cryptographic hash and a short fingerprint (last 6 characters) for display purposes.

## Key Concepts

| Concept | Detail |
|---|---|
| **Key lifecycle** | Create → Use → Optionally set expiry → Delete |
| **Raw key** | Returned only in the `create` response. Never retrievable again. |
| **Fingerprint** | Last 6 characters of the raw key. Used for identification in the UI. |
| **Expiry** | Set an absolute `expires_at` timestamp, or set `never_expires: true`. |
| **Ownership** | An API key belongs to the identity account that created it. |
| **Authorization** | Creating requires only authentication. Editing or deleting requires `can_edit` / `can_delete` on the key resource. |

## Documentation Index

| Document | Description |
|---|---|
| [apikey-resource-guide.md](apikey-resource-guide.md) | YAML schema reference — spec fields, status fields, CLI commands |
| [examples.md](examples.md) | Complete YAML and CLI examples for common scenarios |
| [validation-checklist.md](validation-checklist.md) | Pre-create checklist and common pitfalls |
