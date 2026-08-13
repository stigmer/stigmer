package stigmer

import (
	"context"
	"time"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	billingv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/billing/v1"
	rpc "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/rpc"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Proto payload re-exports for the billing bounded context. Response
// messages are returned as-is (the search.go convention): the proto types
// are the contract, and hand-mapped mirrors would only drift from it.
type (
	// BillingAccount is an organization's billing account with balance and auto-recharge config.
	BillingAccount = billingv1.BillingAccount
	// CreditBalance is the credit balance breakdown (available, reserved, total).
	CreditBalance = billingv1.CreditBalance
	// CreditLedgerEntry is one immutable credit ledger entry.
	CreditLedgerEntry = billingv1.CreditLedgerEntry
	// CreditLedgerResponse is a paginated page of ledger entries.
	CreditLedgerResponse = billingv1.CreditLedgerResponse
	// BillingUsageReportResponse is an aggregated usage report for a date range.
	BillingUsageReportResponse = billingv1.BillingUsageReportResponse
	// CreateCreditCheckoutSessionResponse holds the Stripe-hosted checkout URL.
	CreateCreditCheckoutSessionResponse = billingv1.CreateCreditCheckoutSessionResponse
	// CreateBillingPortalSessionResponse holds the Stripe-hosted portal URL.
	CreateBillingPortalSessionResponse = billingv1.CreateBillingPortalSessionResponse
	// CustomerModelPricingResponse is the customer-facing model price list.
	CustomerModelPricingResponse = billingv1.CustomerModelPricingResponse
	// ModelPricingGovernanceResponse is the operator pricing governance view.
	ModelPricingGovernanceResponse = billingv1.ModelPricingGovernanceResponse
	// ModelPricingBaselinesResponse is the model registry baseline catalog.
	ModelPricingBaselinesResponse = billingv1.ModelPricingBaselinesResponse
	// ModelPricingBaseline is one model registry baseline entry (catalog + list prices).
	ModelPricingBaseline = billingv1.ModelPricingBaseline
	// ModelPricingOverride is one pricing override from the feedback loop.
	ModelPricingOverride = billingv1.ModelPricingOverride
	// LedgerEntryType filters ledger queries to specific entry types.
	LedgerEntryType = billingv1.LedgerEntryType
	// LedgerView selects a server-resolved slice of the ledger.
	LedgerView = billingv1.LedgerView
)

// AdjustCreditsParams configures a manual credit adjustment.
type AdjustCreditsParams struct {
	OrgID string
	// AmountMicros is positive to add credits, negative to remove.
	AmountMicros int64
	// Reason is recorded on the ledger entry (audit trail).
	Reason string
	// IdempotencyKey deduplicates retries of the same adjustment.
	IdempotencyKey string
}

// GetCreditLedgerParams configures a credit ledger query.
type GetCreditLedgerParams struct {
	OrgID string
	// Page selects a result page; nil returns the server default page.
	Page *Page
	// TypeFilter narrows to specific entry types. Empty means all types.
	TypeFilter []LedgerEntryType
	// StartTime filters to entries on or after this timestamp. Zero means unbounded.
	StartTime time.Time
	// EndTime filters to entries on or before this timestamp. Zero means unbounded.
	EndTime time.Time
	// View selects a server-resolved ledger slice. LedgerView_ledger_view_statement
	// returns only customer-facing money-movement entries and excludes internal
	// mechanics (per-call usage debits, reservation holds/releases). When both
	// View and TypeFilter are set, the effective filter is their intersection.
	View LedgerView
}

// GetBillingUsageReportParams configures a billing usage report query.
type GetBillingUsageReportParams struct {
	OrgID     string
	StartTime time.Time
	EndTime   time.Time
}

// CreateCheckoutSessionParams configures a Stripe Checkout Session.
type CreateCheckoutSessionParams struct {
	OrgID      string
	PackID     string
	SuccessURL string
	CancelURL  string
}

// CreateBillingPortalSessionParams configures a Stripe Billing Portal session.
type CreateBillingPortalSessionParams struct {
	OrgID     string
	ReturnURL string
}

// SetAutoRechargeConfigParams configures automatic credit recharge.
type SetAutoRechargeConfigParams struct {
	OrgID                string
	Enabled              bool
	ThresholdMicros      int64
	RechargeAmountMicros int64
	MonthlyCapMicros     int64
}

// GetCustomerModelPricingParams configures a customer model pricing query.
type GetCustomerModelPricingParams struct {
	// OrgID resolves org-specific policy overrides. Empty for default pricing.
	OrgID string
}

// DecideModelPricingOverrideParams records a decision on a pending pricing override.
type DecideModelPricingOverrideParams struct {
	// OverrideID identifies the PENDING_SIGNOFF override to decide.
	OverrideID string
	// Approve true makes the override ACTIVE (superseding any current ACTIVE
	// override on the same pricing key); false rejects it.
	Approve bool
	// DecisionNote is an optional note recorded on the decision (audit trail).
	DecisionNote string
}

// ListModelPricingBaselinesParams configures a baseline catalog query.
type ListModelPricingBaselinesParams struct {
	// IncludeHistory true includes SUPERSEDED and RETIRED revisions (the full
	// audit history). Default: ACTIVE documents only.
	IncludeHistory bool
}

// UpsertModelPricingBaselineParams creates or revises a baseline entry.
type UpsertModelPricingBaselineParams struct {
	// Baseline is the entry to create or revise, keyed by
	// (modelId, provider, harness). Lifecycle fields (baselineId, status,
	// decision stamps, pricing effectiveAt) are server-owned and ignored.
	Baseline *ModelPricingBaseline
	// RevisionNote is an optional operator note recorded on the revision.
	RevisionNote string
}

// RetireModelPricingBaselineParams retires a model from the registry catalog.
type RetireModelPricingBaselineParams struct {
	ModelID  string
	Provider string
	Harness  string
	// RevisionNote is an optional operator note recorded on the retirement.
	RevisionNote string
}

// BillingClient provides the billing bounded context: account provisioning,
// balance queries, ledger history, credit purchases via Stripe Checkout, and
// the operator model-pricing surfaces.
//
// Internal execution-billing RPCs (authorizeExecution, recordLlmCallUsage,
// finalizeExecution) are not exposed — they are called only by the Temporal
// workflow and the LLM proxy.
type BillingClient struct {
	command billingv1.BillingCommandControllerClient
	query   billingv1.BillingQueryControllerClient
}

func newBillingClient(conn grpc.ClientConnInterface) *BillingClient {
	return &BillingClient{
		command: billingv1.NewBillingCommandControllerClient(conn),
		query:   billingv1.NewBillingQueryControllerClient(conn),
	}
}

// GetOrCreateBillingAccount provisions or retrieves the billing account for
// an organization. Idempotent: creates the account on first call, returns the
// existing account on subsequent calls.
func (b *BillingClient) GetOrCreateBillingAccount(ctx context.Context, orgID string) (*BillingAccount, error) {
	resp, err := b.command.GetOrCreateBillingAccount(ctx, &billingv1.GetOrCreateBillingAccountInput{OrgId: orgID})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetBillingAccount retrieves the billing account for an organization.
func (b *BillingClient) GetBillingAccount(ctx context.Context, orgID string) (*BillingAccount, error) {
	resp, err := b.query.GetBillingAccount(ctx, &billingv1.GetBillingAccountInput{OrgId: orgID})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetCreditBalance retrieves the credit balance breakdown for an organization.
func (b *BillingClient) GetCreditBalance(ctx context.Context, orgID string) (*CreditBalance, error) {
	resp, err := b.query.GetCreditBalance(ctx, &billingv1.GetCreditBalanceInput{OrgId: orgID})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// AdjustCredits manually adjusts an organization's credit balance.
//
// Positive AmountMicros adds credits (e.g. funding a tenant org), negative
// removes them. The adjustment is recorded as a ledger entry with the
// supplied reason; the idempotency key deduplicates retries. Requires
// can_manage_billing on the org.
func (b *BillingClient) AdjustCredits(ctx context.Context, params *AdjustCreditsParams) (*CreditLedgerEntry, error) {
	resp, err := b.command.AdjustCredits(ctx, &billingv1.AdjustCreditsInput{
		OrgId:          params.OrgID,
		AmountMicros:   params.AmountMicros,
		Reason:         params.Reason,
		IdempotencyKey: params.IdempotencyKey,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetCreditLedger retrieves paginated credit ledger entries with optional filters.
func (b *BillingClient) GetCreditLedger(ctx context.Context, params *GetCreditLedgerParams) (*CreditLedgerResponse, error) {
	req := &billingv1.GetCreditLedgerInput{
		OrgId:      params.OrgID,
		TypeFilter: params.TypeFilter,
		View:       params.View,
	}
	if params.Page != nil {
		req.Page = &rpc.PageInfo{Num: params.Page.Num, Size: params.Page.Size}
	}
	if !params.StartTime.IsZero() {
		req.StartTime = timestamppb.New(params.StartTime)
	}
	if !params.EndTime.IsZero() {
		req.EndTime = timestamppb.New(params.EndTime)
	}
	resp, err := b.query.GetCreditLedger(ctx, req)
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetBillingUsageReport retrieves an aggregated billing usage report for a
// date range: total provider cost, total billable amount, execution and LLM
// call counts, and a per-model breakdown with cost tier attribution.
func (b *BillingClient) GetBillingUsageReport(ctx context.Context, params *GetBillingUsageReportParams) (*BillingUsageReportResponse, error) {
	resp, err := b.query.GetBillingUsageReport(ctx, &billingv1.GetBillingUsageReportInput{
		OrgId:     params.OrgID,
		StartTime: timestamppb.New(params.StartTime),
		EndTime:   timestamppb.New(params.EndTime),
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// CreateCreditCheckoutSession creates a Stripe Checkout Session to purchase a
// credit pack. The caller should redirect the user to the returned checkout
// URL; credits are provisioned asynchronously via webhook after payment.
func (b *BillingClient) CreateCreditCheckoutSession(ctx context.Context, params *CreateCheckoutSessionParams) (*CreateCreditCheckoutSessionResponse, error) {
	resp, err := b.command.CreateCreditCheckoutSession(ctx, &billingv1.CreateCreditCheckoutSessionInput{
		OrgId:      params.OrgID,
		PackId:     params.PackID,
		SuccessUrl: params.SuccessURL,
		CancelUrl:  params.CancelURL,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// CreateBillingPortalSession creates a Stripe Billing Portal session for
// payment method management. The caller should redirect the user to the
// returned portal URL; changes are synced back via webhooks.
func (b *BillingClient) CreateBillingPortalSession(ctx context.Context, params *CreateBillingPortalSessionParams) (*CreateBillingPortalSessionResponse, error) {
	resp, err := b.command.CreateBillingPortalSession(ctx, &billingv1.CreateBillingPortalSessionInput{
		OrgId:     params.OrgID,
		ReturnUrl: params.ReturnURL,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// SetAutoRechargeConfig configures automatic credit recharge for an
// organization. When enabled, the billing system charges the account's saved
// payment method whenever the available balance drops below the configured
// threshold. Returns the updated BillingAccount.
func (b *BillingClient) SetAutoRechargeConfig(ctx context.Context, params *SetAutoRechargeConfigParams) (*BillingAccount, error) {
	resp, err := b.command.SetAutoRechargeConfig(ctx, &billingv1.SetAutoRechargeConfigInput{
		OrgId:                params.OrgID,
		Enabled:              params.Enabled,
		ThresholdMicros:      params.ThresholdMicros,
		RechargeAmountMicros: params.RechargeAmountMicros,
		MonthlyCapMicros:     params.MonthlyCapMicros,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetCustomerModelPricing retrieves the customer-facing model price list with
// markup applied — the prices the customer pays, organized by harness and
// cost tier. Pass params to resolve org-specific policy overrides; nil params
// returns default pricing.
func (b *BillingClient) GetCustomerModelPricing(ctx context.Context, params *GetCustomerModelPricingParams) (*CustomerModelPricingResponse, error) {
	req := &billingv1.GetCustomerModelPricingInput{}
	if params != nil {
		req.OrgId = params.OrgID
	}
	resp, err := b.query.GetCustomerModelPricing(ctx, req)
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetModelPricingGovernance retrieves the platform pricing governance view:
// baseline vs effective rates per model, ACTIVE override provenance, and
// pending sign-off proposals from the pricing feedback loop.
//
// Platform-operator surface (can_manage_model_pricing on platform:stigmer):
// rates are raw provider prices, pre-markup.
func (b *BillingClient) GetModelPricingGovernance(ctx context.Context) (*ModelPricingGovernanceResponse, error) {
	resp, err := b.query.GetModelPricingGovernance(ctx, &billingv1.GetModelPricingGovernanceInput{})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// ListModelPricingBaselines retrieves the model registry baseline catalog:
// ACTIVE entries by default, or the full append-only revision history with
// IncludeHistory. Nil params lists ACTIVE entries.
//
// Platform-operator surface (can_manage_model_pricing on platform:stigmer):
// rates are raw provider prices, pre-markup.
func (b *BillingClient) ListModelPricingBaselines(ctx context.Context, params *ListModelPricingBaselinesParams) (*ModelPricingBaselinesResponse, error) {
	req := &billingv1.ListModelPricingBaselinesInput{}
	if params != nil {
		req.IncludeHistory = params.IncludeHistory
	}
	resp, err := b.query.ListModelPricingBaselines(ctx, req)
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// DecideModelPricingOverride records a human decision on a PENDING_SIGNOFF
// pricing override. Approving makes the override ACTIVE (superseding any
// current ACTIVE override on the same pricing key) and recomposes the
// effective registry; rejecting archives it for audit. Returns the decided
// override with the decision stamped.
func (b *BillingClient) DecideModelPricingOverride(ctx context.Context, params *DecideModelPricingOverrideParams) (*ModelPricingOverride, error) {
	resp, err := b.command.DecideModelPricingOverride(ctx, &billingv1.DecideModelPricingOverrideInput{
		OverrideId:   params.OverrideID,
		Approve:      params.Approve,
		DecisionNote: params.DecisionNote,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// UpsertModelPricingBaseline creates or revises one model registry baseline
// entry (catalog + list prices). Append-only: an existing ACTIVE entry for
// the same (modelId, provider, harness) key is superseded, never mutated, and
// the effective registry recomposes immediately. Returns the new revision
// with server-stamped lifecycle fields.
func (b *BillingClient) UpsertModelPricingBaseline(ctx context.Context, params *UpsertModelPricingBaselineParams) (*ModelPricingBaseline, error) {
	resp, err := b.command.UpsertModelPricingBaseline(ctx, &billingv1.UpsertModelPricingBaselineInput{
		Baseline:     params.Baseline,
		RevisionNote: params.RevisionNote,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// RetireModelPricingBaseline retires one model from the registry catalog.
// The model disappears from every price surface on the next composition pass;
// the document is kept for audit and the key can be revived by a subsequent
// upsert.
func (b *BillingClient) RetireModelPricingBaseline(ctx context.Context, params *RetireModelPricingBaselineParams) (*ModelPricingBaseline, error) {
	resp, err := b.command.RetireModelPricingBaseline(ctx, &billingv1.RetireModelPricingBaselineInput{
		ModelId:      params.ModelID,
		Provider:     params.Provider,
		Harness:      params.Harness,
		RevisionNote: params.RevisionNote,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}
