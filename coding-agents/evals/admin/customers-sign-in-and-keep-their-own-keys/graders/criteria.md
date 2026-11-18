---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says their users reach Stigmer without a Stigmer login, either by identity federation (their Auth0 registered as a Federation Issuer) or by their backend minting a user token per user with an admin service account's key.
- Says each firm's key goes in a vault of that firm's own that only that firm's users can use, for example a child organization per firm holding its vault, or one private shared vault per firm.
- Warns never to give a firm's vault **Organization** visibility in an Organization several firms share, since any member could then name another firm's vault.

**FAIL if**

- It puts all firms' keys in one shared vault with Organization visibility.
- It puts keys in the Agent's instructions or the standing user context.
- It says their users each need a Stigmer account or login.
- It says federation is unavailable on Stigmer Cloud.
- It invents an API or setting the docs do not name.

**Welcome**

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
