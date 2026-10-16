package stigmer

import (
	"context"
	"iter"

	"go.stigmer.ai/sdk/internal/gen"
	billingv1 "go.stigmer.ai/sdk/proto/ai/stigmer/billing/v1"
	"google.golang.org/grpc"
)

// Proto payload re-exports for the billing bounded context. Response
// messages are returned as-is (the search.go convention): the proto types
// are the contract, and hand-mapped mirrors would only drift from it.
type (
	// BillingAccount is an organization's billing account: its Stripe customer and status.
	BillingAccount = billingv1.BillingAccount
	// CreateBillingPortalSessionResponse holds the Stripe-hosted portal URL.
	CreateBillingPortalSessionResponse = billingv1.CreateBillingPortalSessionResponse
	// CreatePaymentMethodSetupSessionResponse holds the Stripe-hosted setup URL.
	CreatePaymentMethodSetupSessionResponse = billingv1.CreatePaymentMethodSetupSessionResponse
	// ModelPricingBaselinesResponse is the model registry baseline catalog.
	ModelPricingBaselinesResponse = billingv1.ModelPricingBaselinesResponse
	// ModelPricingBaseline is one model registry baseline entry (catalog + list prices).
	ModelPricingBaseline = billingv1.ModelPricingBaseline
)

// CreateBillingPortalSessionParams configures a Stripe Billing Portal session.
type CreateBillingPortalSessionParams struct {
	Org       string
	ReturnURL string
}

// CreatePaymentMethodSetupSessionParams configures a Stripe Checkout Session
// that saves a payment method without charging it.
type CreatePaymentMethodSetupSessionParams struct {
	Org        string
	SuccessURL string
	CancelURL  string
}

// ListModelPricingBaselinesParams configures a baseline catalog query.
type ListModelPricingBaselinesParams struct {
	// IncludeHistory true includes SUPERSEDED and RETIRED revisions (the full
	// audit history). Default: ACTIVE documents only.
	IncludeHistory bool
	// PageSize is the most entries to return: 0 asks for the default page
	// of 50, and above 100 reads 100.
	PageSize int32
	// PageToken is the previous response's NextPageToken, to continue the
	// same list.
	PageToken string
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

// BillingClient provides the billing bounded context: the organization's
// billing account (its Stripe customer), the Stripe portal and card setup
// sessions, and the operator model-pricing surfaces. Token usage is read from
// the run client's usage reports (GetRunUsageReport, GetSessionUsageReport,
// GetAgentUsageReport, GetOrgUsageReport), counted in tokens and never priced.
//
// The proxy's metering write (recordLlmCallUsage) is not exposed; only the
// server calls it.
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
func (b *BillingClient) GetOrCreateBillingAccount(ctx context.Context, org string) (*BillingAccount, error) {
	resp, err := b.command.GetOrCreateBillingAccount(ctx, &billingv1.GetOrCreateBillingAccountInput{Org: org})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetBillingAccount retrieves the billing account for an organization.
func (b *BillingClient) GetBillingAccount(ctx context.Context, org string) (*BillingAccount, error) {
	resp, err := b.query.GetBillingAccount(ctx, &billingv1.GetBillingAccountInput{Org: org})
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
		Org:       params.Org,
		ReturnUrl: params.ReturnURL,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// CreatePaymentMethodSetupSession creates a Stripe Checkout Session that
// saves a payment method without charging it. The caller should redirect the
// user to the returned setup URL; this is how an organization puts a card on
// file for its plan's invoices.
func (b *BillingClient) CreatePaymentMethodSetupSession(ctx context.Context, params *CreatePaymentMethodSetupSessionParams) (*CreatePaymentMethodSetupSessionResponse, error) {
	resp, err := b.command.CreatePaymentMethodSetupSession(ctx, &billingv1.CreatePaymentMethodSetupSessionInput{
		Org:        params.Org,
		SuccessUrl: params.SuccessURL,
		CancelUrl:  params.CancelURL,
	})
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
// rates are the providers' list prices.
func (b *BillingClient) ListModelPricingBaselines(ctx context.Context, params *ListModelPricingBaselinesParams) (*ModelPricingBaselinesResponse, error) {
	resp, err := b.query.ListModelPricingBaselines(ctx, baselinesRequest(params))
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// ListModelPricingBaselinesAll returns every baseline of the catalog, page
// after page: it follows NextPageToken from the token params names until
// the catalog ends. The sequence yields the first error and stops;
// breaking out of the loop stops the reads.
func (b *BillingClient) ListModelPricingBaselinesAll(ctx context.Context, params *ListModelPricingBaselinesParams) iter.Seq2[*ModelPricingBaseline, error] {
	return func(yield func(*ModelPricingBaseline, error) bool) {
		req := baselinesRequest(params)
		for {
			page, err := b.query.ListModelPricingBaselines(ctx, req)
			if err != nil {
				yield(nil, gen.WrapErr(err))
				return
			}
			for _, entry := range page.GetEntries() {
				if !yield(entry, nil) {
					return
				}
			}
			if page.GetNextPageToken() == "" {
				return
			}
			req.PageToken = page.GetNextPageToken()
		}
	}
}

func baselinesRequest(params *ListModelPricingBaselinesParams) *billingv1.ListModelPricingBaselinesInput {
	req := &billingv1.ListModelPricingBaselinesInput{}
	if params != nil {
		req.IncludeHistory = params.IncludeHistory
		req.PageSize = params.PageSize
		req.PageToken = params.PageToken
	}
	return req
}

// UpsertModelPricingBaseline creates or revises one model registry baseline
// entry (catalog + list prices). Append-only: an existing ACTIVE entry for
// the same (modelId, provider, harness) key is superseded, never mutated, and
// the registry is rebuilt immediately. Returns the new revision
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
// The rebuilt registry drops it from every price surface; the document is kept
// for audit and the key can be revived by a subsequent
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
