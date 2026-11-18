What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Tokens are bound to one Organization, or to the child organization an `externalIdClaim` claim names.
- Users who chat need the Member role (for example as the sign-in role); a viewer cannot start a conversation.
- Creating each firm's vault with `external_id` set to their customer id, and finding it again with `getByExternalId`.
- Values go in through a hidden prompt, a file or an environment variable (`stigmer vault set-secret ... --from-env`) or the SDK's `setSecrets`, never on the command line.
- Minted users' runs read no My vault.
- Rotating a key is saving the same name again; the next run uses it.
- A run's `credentials.sources` shows which vault each key came from.
- Federation provisions accounts JIT or manually; minting is `mintUserToken` on their backend; either route gives each user an Identity Account.
- A child organization per firm needs a Stigmer Cloud plan that includes them, and the firm's vault there can have **Organization** visibility.
- All in one Organization, each firm's private shared vault is granted **Can use** only to that firm's accounts and is named on that firm's conversations.
