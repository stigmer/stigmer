# Tasks: 20260325.01.auto-personal-org

**Created**: 2026-03-25

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Add `is_personal` field to OrganizationSpec proto and regenerate stubs

**Status**: ⏸️ TODO
**Created**: 2026-03-25 10:16
**Estimated**: ~0.5 day

### Subtasks
- [ ] Add `bool is_personal = 6` to `OrganizationSpec` in `apis/ai/stigmer/tenancy/organization/v1/spec.proto`
- [ ] Add proto comment: immutable after creation, set by server during identity provisioning
- [ ] Regenerate Go stubs (`stigmer-cloud` via buf)
- [ ] Regenerate TypeScript stubs (`sdk/typescript`)
- [ ] Verify generated code compiles / type-checks

### Key Files
- `apis/ai/stigmer/tenancy/organization/v1/spec.proto`
- `apis/ai/stigmer/tenancy/organization/v1/api.proto` (slug validation rules — no changes needed)

### Notes
- Field number 6 is next available in `OrganizationSpec` (fields 1-5 are taken)
- Using `bool is_personal` over an enum because there is no foreseeable third org type
- Mark as immutable (like `management_mode`) — cannot flip personal↔team after creation
- Personal orgs are structurally identical to team orgs — same capabilities, same resource ownership

## Task 2: Server-side auto-creation in identity provisioning handler

**Status**: ⏸️ TODO
**Created**: 2026-03-25 10:16
**Estimated**: ~2-3 days
**Repo**: `stigmer-cloud`

### Subtasks
- [ ] Slug generation logic: email local part → sanitize to `^[a-z][a-z0-9-]*$` (2-15 chars)
- [ ] Slug conflict handling: if taken, append short random suffix (e.g., `suresh-x7k`)
- [ ] In `IdentityAccountCommandController.create` handler: after identity creation, auto-create personal org
- [ ] Set FGA `owner` tuple on personal org to the new identity account
- [ ] Set `is_personal = true` and `org = slug` (self-owning)
- [ ] Set org `name` to `first_name + last_name` (fallback: email local part)
- [ ] Idempotency: if personal org already exists for this identity, skip creation
- [ ] Deletion guard in `OrganizationCommandController.delete`: reject deletion of personal orgs (or require identity deletion first)
- [ ] `is_personal` immutability: reject `update` calls that attempt to change this field

### Key Design Decisions
- Auto-creation happens server-side during identity provisioning, NOT client-side
- The `create` RPC already skips authorization — server calling it as system is fine
- Personal org is a real org — all downstream resource scoping via `metadata.org` works unchanged
- One personal org per identity (enforced by idempotency check)

### Notes
- Server handler code is in `stigmer-cloud`, not `stigmer` repo
- The identity creation flow is triggered by Auth0 signup webhook
- Consider doing this in the same Temporal workflow if identity creation goes through one

## Task 3: Web console updates — OrgGate fallback, OrgSwitcher personal org distinction

**Status**: ⏸️ TODO
**Created**: 2026-03-25 10:16
**Estimated**: ~0.5-1 day

### Subtasks
- [ ] `OrgGate.tsx`: Keep "no orgs" state as fallback (rare edge case for cloud users, still needed for OSS/local)
- [ ] `OrgSwitcher.tsx`: Show personal org with user icon (e.g., `User` from lucide) instead of `Building2`
- [ ] `OrgSwitcher.tsx`: Label personal org distinctly (user's name/avatar)
- [ ] `CreateOrganizationForm.tsx`: No changes needed — creating from switcher always creates team orgs (`is_personal = false`)
- [ ] Consider: new user post-onboarding — redirect to "getting started" or "first agent" instead of empty dashboard (stretch goal)

### Key Files
- `client-apps/web/src/components/auth/OrgGate.tsx`
- `client-apps/web/src/components/layout/OrgSwitcher.tsx`
- `client-apps/web/src/contexts/org-context.tsx`
- `sdk/react/src/organization/CreateOrganizationForm.tsx` (no changes expected)

### Notes
- The `OrgGate` "Welcome to Stigmer" screen will almost never be seen by cloud users after this change
- Personal vs team org distinction is purely visual in the UI — same capabilities
- SDK components (`@stigmer/react`) may eventually expose `isPersonal` in org-related hooks

## Task 4: Lazy backfill for existing users

**Status**: ⏸️ TODO
**Created**: 2026-03-25 10:16
**Estimated**: included in Task 2 server work
**Repo**: `stigmer-cloud`

### Subtasks
- [ ] In auth webhook / login flow: check if identity has a personal org
- [ ] If no personal org exists, create one (same logic as Task 2)
- [ ] This covers existing users who signed up before auto-creation was added

### Notes
- Lazy approach avoids a big-bang migration script
- Alternative: one-time migration script that creates personal orgs for all existing identities
- Lazy is simpler and lower risk — personal org gets created on next login
- The identity's `findMyOrganizations` will include the newly created personal org

## Task 5: Testing and validation

**Status**: ⏸️ TODO
**Created**: 2026-03-25 10:16
**Estimated**: ~1 day

### Subtasks
- [ ] Unit tests for slug generation (email → slug sanitization, various edge cases)
- [ ] Unit tests for slug conflict resolution (suffix appending)
- [ ] Unit tests for deletion guard (reject personal org deletion)
- [ ] Unit tests for `is_personal` immutability
- [ ] Integration test: end-to-end identity creation → personal org exists
- [ ] Integration test: existing user login → personal org backfilled
- [ ] Manual validation: web console flow (sign up → land in workspace)
- [ ] Manual validation: CLI flow (login → context auto-set to personal org)


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

