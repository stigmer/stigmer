# Auto-Recharge Configuration (Phase 4.2)

**Date**: May 4, 2026

## Summary

Added the `setAutoRechargeConfig` RPC and a full-stack UI so org admins can configure automatic credit top-up — setting a trigger threshold, a fixed recharge amount, and a monthly cap. This is the configuration layer only; the actual recharge trigger (creating off-session PaymentIntents via Stripe) is deferred to Phase 4.3.

## Problem Statement

After Phase 4.1 shipped payment method management via the Stripe Customer Portal, users can save a card but have no way to prevent their credits from running out during agent executions. Without auto-recharge configuration, every credit depletion requires a manual purchase — a friction point that interrupts workflows and causes execution failures.

### Pain Points

- Users must manually monitor credit balances and purchase packs proactively
- Agent executions fail when credits deplete mid-run (graceful stop, but still disruptive)
- No path for "set it and forget it" credit management

## Solution

Implemented the auto-recharge configuration layer across the full stack:

1. **Proto contract**: `SetAutoRechargeConfigInput` message + `setAutoRechargeConfig` RPC returning `BillingAccount`
2. **Proto cleanup**: Removed unused `AutoRechargeConfig.default_payment_method_id` (Phase 0 placeholder) and added `current_month` field for Phase 4.3 monthly cap tracking
3. **Backend handler + validation**: Domain service validates amounts, PM requirement, and account status before persisting atomically
4. **TypeScript SDK**: `BillingClient.setAutoRechargeConfig()` method
5. **React SDK**: `useSetAutoRechargeConfig` hook + `AutoRechargeCard` component with toggle, dollar inputs, and save button
6. **Docs**: Updated `billing.mdx` with new hook, component, and type entries

## Implementation Details

### Proto Changes

- `AutoRechargeConfig`: Removed field 6 (`default_payment_method_id` — was a Phase 0 placeholder, superseded by `BillingAccount.default_payment_method` in Phase 4.1). Added field 7 (`current_month` — system-managed, `"YYYY-MM"` format, for lazy monthly cap reset in Phase 4.3).
- `SetAutoRechargeConfigInput`: User-configurable fields only (`enabled`, `threshold_micros`, `recharge_amount_micros`, `monthly_cap_micros`). System-managed counters are preserved by the repo's targeted `$set`.
- RPC returns `BillingAccount` (not a custom response) — consistent with `getOrCreateBillingAccount`.

### Backend (stigmer-cloud)

- `BillingAccountRepo.atomicSetAutoRechargeConfig()`: Uses `$set` on individual `auto_recharge.*` sub-fields to preserve system-managed counters (`current_month_charged_micros`, `current_month`). Does NOT replace the entire sub-document.
- `BillingAccountService.setAutoRechargeConfig()`: Domain validation with two paths:
  - **Enabling**: threshold > 0, amount > 0, cap >= amount, account active, payment method exists
  - **Disabling**: non-negative amounts only (preserves config for easy re-enable)
- `SetAutoRechargeConfigHandler`: Standard pipeline (validate → extract → authorize → execute → respond) with `can_manage_billing` permission.
- 12 service tests + 3 repo tests, all passing. Registered `billing_account_service_test` Bazel target (was previously missing).

### React Component

`AutoRechargeCard` with: toggle switch, three dollar-denominated input fields (threshold, recharge amount, monthly cap), save button with dirty-state tracking, disabled state when no payment method is on file, inline success/error feedback. Positioned between `PaymentMethodCard` and `CreditPackGrid` in `BillingSection`.

## Benefits

- Users can pre-configure auto-recharge settings in the billing UI before Phase 4.3 enables the trigger
- Configuration is persisted atomically without affecting balance fields or system counters
- Proto cleanup removes dead field and lays groundwork for Phase 4.3 monthly cap tracking
- 15 unit tests ensure validation correctness across all edge cases

## Impact

- **Users**: Billing settings page now shows auto-recharge configuration card (visible immediately, but recharges won't trigger until Phase 4.3)
- **Developers**: 12th gRPC RPC handler-wired in the billing bounded context
- **Architecture**: `AutoRechargeConfig` proto is now clean — user-configurable fields (1-4) vs system-managed fields (5, 7) are clearly documented

## Related Work

- Phase 4.1: Payment method management via Stripe Customer Portal — prerequisite for auto-recharge
- Phase 4.3 (next): Recharge trigger — creates off-session PaymentIntent when balance drops below threshold
- Phase 4.4: Recharge failure handling (retry, disable, notify)
- Phase 4.5: Webhook handling for recharge PaymentIntents

---

**Status**: Production Ready
**Timeline**: ~2 hours
