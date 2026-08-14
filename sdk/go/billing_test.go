package stigmer

// Wire-shape tests for BillingClient: each test injects a fake generated stub
// that captures the outgoing request proto and returns a canned response, then
// asserts the SDK params mapped onto the right proto fields. This mirrors
// sdk/java's BillingClientTest and is the reference pattern for testing the
// handwritten (non-resource) clients.

import (
	"context"
	"errors"
	"testing"
	"time"

	billingv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/billing/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fakeBillingCommand captures requests to the command controller. Only the
// RPCs exercised by tests are implemented with capture-and-respond bodies;
// the engine-internal RPCs return nil because the SDK never calls them.
type fakeBillingCommand struct {
	billingv1.BillingCommandControllerClient

	adjustCreditsIn  *billingv1.AdjustCreditsInput
	adjustCreditsOut *billingv1.CreditLedgerEntry
	adjustCreditsErr error

	grantCreditsIn  *billingv1.GrantCreditsInput
	grantCreditsOut *billingv1.CreditLedgerEntry
	grantCreditsErr error

	autoRechargeIn *billingv1.SetAutoRechargeConfigInput
	checkoutIn     *billingv1.CreateCreditCheckoutSessionInput
	retireIn       *billingv1.RetireModelPricingBaselineInput
}

func (f *fakeBillingCommand) AdjustCredits(_ context.Context, in *billingv1.AdjustCreditsInput, _ ...grpc.CallOption) (*billingv1.CreditLedgerEntry, error) {
	f.adjustCreditsIn = in
	if f.adjustCreditsErr != nil {
		return nil, f.adjustCreditsErr
	}
	return f.adjustCreditsOut, nil
}

func (f *fakeBillingCommand) GrantCredits(_ context.Context, in *billingv1.GrantCreditsInput, _ ...grpc.CallOption) (*billingv1.CreditLedgerEntry, error) {
	f.grantCreditsIn = in
	if f.grantCreditsErr != nil {
		return nil, f.grantCreditsErr
	}
	return f.grantCreditsOut, nil
}

func (f *fakeBillingCommand) SetAutoRechargeConfig(_ context.Context, in *billingv1.SetAutoRechargeConfigInput, _ ...grpc.CallOption) (*billingv1.BillingAccount, error) {
	f.autoRechargeIn = in
	return &billingv1.BillingAccount{}, nil
}

func (f *fakeBillingCommand) CreateCreditCheckoutSession(_ context.Context, in *billingv1.CreateCreditCheckoutSessionInput, _ ...grpc.CallOption) (*billingv1.CreateCreditCheckoutSessionResponse, error) {
	f.checkoutIn = in
	return &billingv1.CreateCreditCheckoutSessionResponse{}, nil
}

func (f *fakeBillingCommand) RetireModelPricingBaseline(_ context.Context, in *billingv1.RetireModelPricingBaselineInput, _ ...grpc.CallOption) (*billingv1.ModelPricingBaseline, error) {
	f.retireIn = in
	return &billingv1.ModelPricingBaseline{}, nil
}

// fakeBillingQuery captures requests to the query controller.
type fakeBillingQuery struct {
	billingv1.BillingQueryControllerClient

	ledgerIn  *billingv1.GetCreditLedgerInput
	usageIn   *billingv1.GetBillingUsageReportInput
	pricingIn *billingv1.GetCustomerModelPricingInput
	listIn    *billingv1.ListModelPricingBaselinesInput
}

func (f *fakeBillingQuery) GetCreditLedger(_ context.Context, in *billingv1.GetCreditLedgerInput, _ ...grpc.CallOption) (*billingv1.CreditLedgerResponse, error) {
	f.ledgerIn = in
	return &billingv1.CreditLedgerResponse{}, nil
}

func (f *fakeBillingQuery) GetBillingUsageReport(_ context.Context, in *billingv1.GetBillingUsageReportInput, _ ...grpc.CallOption) (*billingv1.BillingUsageReportResponse, error) {
	f.usageIn = in
	return &billingv1.BillingUsageReportResponse{}, nil
}

func (f *fakeBillingQuery) GetCustomerModelPricing(_ context.Context, in *billingv1.GetCustomerModelPricingInput, _ ...grpc.CallOption) (*billingv1.CustomerModelPricingResponse, error) {
	f.pricingIn = in
	return &billingv1.CustomerModelPricingResponse{}, nil
}

func (f *fakeBillingQuery) ListModelPricingBaselines(_ context.Context, in *billingv1.ListModelPricingBaselinesInput, _ ...grpc.CallOption) (*billingv1.ModelPricingBaselinesResponse, error) {
	f.listIn = in
	return &billingv1.ModelPricingBaselinesResponse{}, nil
}

func TestBillingAdjustCredits_MapsParams(t *testing.T) {
	fake := &fakeBillingCommand{
		adjustCreditsOut: &billingv1.CreditLedgerEntry{AmountMicros: 25_000_000},
	}
	client := &BillingClient{command: fake}

	entry, err := client.AdjustCredits(context.Background(), &AdjustCreditsParams{
		OrgID:          "acme",
		AmountMicros:   25_000_000,
		Reason:         "initial tenant funding",
		IdempotencyKey: "fund-acme-001",
	})
	if err != nil {
		t.Fatalf("AdjustCredits: %v", err)
	}
	if entry.GetAmountMicros() != 25_000_000 {
		t.Errorf("entry.AmountMicros = %d, want 25000000", entry.GetAmountMicros())
	}

	in := fake.adjustCreditsIn
	if in.GetOrgId() != "acme" {
		t.Errorf("OrgId = %q, want acme", in.GetOrgId())
	}
	if in.GetAmountMicros() != 25_000_000 {
		t.Errorf("AmountMicros = %d, want 25000000", in.GetAmountMicros())
	}
	if in.GetReason() != "initial tenant funding" {
		t.Errorf("Reason = %q", in.GetReason())
	}
	if in.GetIdempotencyKey() != "fund-acme-001" {
		t.Errorf("IdempotencyKey = %q", in.GetIdempotencyKey())
	}
}

func TestBillingAdjustCredits_WrapsGRPCError(t *testing.T) {
	fake := &fakeBillingCommand{
		adjustCreditsErr: status.Error(codes.PermissionDenied, "can_manage_billing required"),
	}
	client := &BillingClient{command: fake}

	_, err := client.AdjustCredits(context.Background(), &AdjustCreditsParams{OrgID: "acme"})
	var sdkErr *Error
	if !errors.As(err, &sdkErr) {
		t.Fatalf("error = %v (%T), want *stigmer.Error", err, err)
	}
	if sdkErr.GRPCCode != codes.PermissionDenied {
		t.Errorf("GRPCCode = %v, want PermissionDenied", sdkErr.GRPCCode)
	}
}

func TestBillingGrantCredits_MapsParams(t *testing.T) {
	fake := &fakeBillingCommand{
		grantCreditsOut: &billingv1.CreditLedgerEntry{AmountMicros: 5_000_000},
	}
	client := &BillingClient{command: fake}

	expiresAt := time.Date(2026, 8, 31, 23, 59, 59, 0, time.UTC)
	entry, err := client.GrantCredits(context.Background(), &GrantCreditsParams{
		OrgID:          "acme",
		AmountMicros:   5_000_000,
		ExpiresAt:      expiresAt,
		Reason:         "monthly free allowance 2026-08",
		IdempotencyKey: "allowance-acme-2026-08",
	})
	if err != nil {
		t.Fatalf("GrantCredits: %v", err)
	}
	if entry.GetAmountMicros() != 5_000_000 {
		t.Errorf("entry.AmountMicros = %d, want 5000000", entry.GetAmountMicros())
	}

	in := fake.grantCreditsIn
	if in.GetOrgId() != "acme" {
		t.Errorf("OrgId = %q, want acme", in.GetOrgId())
	}
	if in.GetAmountMicros() != 5_000_000 {
		t.Errorf("AmountMicros = %d, want 5000000", in.GetAmountMicros())
	}
	if got := in.GetExpiresAt().AsTime(); !got.Equal(expiresAt) {
		t.Errorf("ExpiresAt = %v, want %v", got, expiresAt)
	}
	if in.GetReason() != "monthly free allowance 2026-08" {
		t.Errorf("Reason = %q", in.GetReason())
	}
	if in.GetIdempotencyKey() != "allowance-acme-2026-08" {
		t.Errorf("IdempotencyKey = %q", in.GetIdempotencyKey())
	}
}

func TestBillingGrantCredits_OmitsUnsetExpiry(t *testing.T) {
	fake := &fakeBillingCommand{grantCreditsOut: &billingv1.CreditLedgerEntry{}}
	client := &BillingClient{command: fake}

	if _, err := client.GrantCredits(context.Background(), &GrantCreditsParams{
		OrgID:          "acme",
		AmountMicros:   1_000_000,
		Reason:         "welcome credit",
		IdempotencyKey: "welcome-acme",
	}); err != nil {
		t.Fatalf("GrantCredits: %v", err)
	}

	if fake.grantCreditsIn.GetExpiresAt() != nil {
		t.Errorf("ExpiresAt = %v, want unset for a never-expiring grant", fake.grantCreditsIn.GetExpiresAt())
	}
}

func TestBillingGrantCredits_WrapsGRPCError(t *testing.T) {
	fake := &fakeBillingCommand{
		grantCreditsErr: status.Error(codes.PermissionDenied, "can_manage_billing required"),
	}
	client := &BillingClient{command: fake}

	_, err := client.GrantCredits(context.Background(), &GrantCreditsParams{OrgID: "acme"})
	var sdkErr *Error
	if !errors.As(err, &sdkErr) {
		t.Fatalf("error = %v (%T), want *stigmer.Error", err, err)
	}
	if sdkErr.GRPCCode != codes.PermissionDenied {
		t.Errorf("GRPCCode = %v, want PermissionDenied", sdkErr.GRPCCode)
	}
}

func TestBillingGetCreditLedger_MapsAllFilters(t *testing.T) {
	fake := &fakeBillingQuery{}
	client := &BillingClient{query: fake}

	start := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 13, 0, 0, 0, 0, time.UTC)
	_, err := client.GetCreditLedger(context.Background(), &GetCreditLedgerParams{
		OrgID:      "acme",
		Page:       &Page{Num: 2, Size: 50},
		TypeFilter: []LedgerEntryType{billingv1.LedgerEntryType_adjustment_credit},
		StartTime:  start,
		EndTime:    end,
		View:       billingv1.LedgerView_ledger_view_statement,
	})
	if err != nil {
		t.Fatalf("GetCreditLedger: %v", err)
	}

	in := fake.ledgerIn
	if in.GetOrgId() != "acme" {
		t.Errorf("OrgId = %q, want acme", in.GetOrgId())
	}
	if in.GetPage().GetNum() != 2 || in.GetPage().GetSize() != 50 {
		t.Errorf("Page = %v, want num=2 size=50", in.GetPage())
	}
	if len(in.GetTypeFilter()) != 1 || in.GetTypeFilter()[0] != billingv1.LedgerEntryType_adjustment_credit {
		t.Errorf("TypeFilter = %v", in.GetTypeFilter())
	}
	if got := in.GetStartTime().AsTime(); !got.Equal(start) {
		t.Errorf("StartTime = %v, want %v", got, start)
	}
	if got := in.GetEndTime().AsTime(); !got.Equal(end) {
		t.Errorf("EndTime = %v, want %v", got, end)
	}
	if in.GetView() != billingv1.LedgerView_ledger_view_statement {
		t.Errorf("View = %v, want statement", in.GetView())
	}
}

func TestBillingGetCreditLedger_OmitsUnsetOptionals(t *testing.T) {
	fake := &fakeBillingQuery{}
	client := &BillingClient{query: fake}

	if _, err := client.GetCreditLedger(context.Background(), &GetCreditLedgerParams{OrgID: "acme"}); err != nil {
		t.Fatalf("GetCreditLedger: %v", err)
	}

	in := fake.ledgerIn
	if in.GetPage() != nil {
		t.Errorf("Page = %v, want nil", in.GetPage())
	}
	if in.GetStartTime() != nil || in.GetEndTime() != nil {
		t.Errorf("time range = [%v, %v], want unset", in.GetStartTime(), in.GetEndTime())
	}
	if in.GetView() != billingv1.LedgerView_ledger_view_unspecified {
		t.Errorf("View = %v, want unspecified", in.GetView())
	}
}

func TestBillingGetBillingUsageReport_MapsTimestamps(t *testing.T) {
	fake := &fakeBillingQuery{}
	client := &BillingClient{query: fake}

	start := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 7, 31, 23, 59, 59, 0, time.UTC)
	if _, err := client.GetBillingUsageReport(context.Background(), &GetBillingUsageReportParams{
		OrgID:     "acme",
		StartTime: start,
		EndTime:   end,
	}); err != nil {
		t.Fatalf("GetBillingUsageReport: %v", err)
	}

	in := fake.usageIn
	if in.GetOrgId() != "acme" {
		t.Errorf("OrgId = %q, want acme", in.GetOrgId())
	}
	if got := in.GetStartTime().AsTime(); !got.Equal(start) {
		t.Errorf("StartTime = %v, want %v", got, start)
	}
	if got := in.GetEndTime().AsTime(); !got.Equal(end) {
		t.Errorf("EndTime = %v, want %v", got, end)
	}
}

func TestBillingSetAutoRechargeConfig_MapsParams(t *testing.T) {
	fake := &fakeBillingCommand{}
	client := &BillingClient{command: fake}

	if _, err := client.SetAutoRechargeConfig(context.Background(), &SetAutoRechargeConfigParams{
		OrgID:                "acme",
		Enabled:              true,
		ThresholdMicros:      5_000_000,
		RechargeAmountMicros: 20_000_000,
		MonthlyCapMicros:     100_000_000,
	}); err != nil {
		t.Fatalf("SetAutoRechargeConfig: %v", err)
	}

	in := fake.autoRechargeIn
	if !in.GetEnabled() {
		t.Error("Enabled = false, want true")
	}
	if in.GetThresholdMicros() != 5_000_000 ||
		in.GetRechargeAmountMicros() != 20_000_000 ||
		in.GetMonthlyCapMicros() != 100_000_000 {
		t.Errorf("micros = (%d, %d, %d), want (5000000, 20000000, 100000000)",
			in.GetThresholdMicros(), in.GetRechargeAmountMicros(), in.GetMonthlyCapMicros())
	}
}

func TestBillingCreateCreditCheckoutSession_MapsParams(t *testing.T) {
	fake := &fakeBillingCommand{}
	client := &BillingClient{command: fake}

	if _, err := client.CreateCreditCheckoutSession(context.Background(), &CreateCheckoutSessionParams{
		OrgID:      "acme",
		PackID:     "pack-25",
		SuccessURL: "https://app.example.com/billing?ok=1",
		CancelURL:  "https://app.example.com/billing",
	}); err != nil {
		t.Fatalf("CreateCreditCheckoutSession: %v", err)
	}

	in := fake.checkoutIn
	if in.GetPackId() != "pack-25" {
		t.Errorf("PackId = %q, want pack-25", in.GetPackId())
	}
	if in.GetSuccessUrl() != "https://app.example.com/billing?ok=1" || in.GetCancelUrl() != "https://app.example.com/billing" {
		t.Errorf("urls = (%q, %q)", in.GetSuccessUrl(), in.GetCancelUrl())
	}
}

func TestBillingGetCustomerModelPricing_NilParamsMeansDefaultPricing(t *testing.T) {
	fake := &fakeBillingQuery{}
	client := &BillingClient{query: fake}

	if _, err := client.GetCustomerModelPricing(context.Background(), nil); err != nil {
		t.Fatalf("GetCustomerModelPricing: %v", err)
	}
	if fake.pricingIn.GetOrgId() != "" {
		t.Errorf("OrgId = %q, want empty for default pricing", fake.pricingIn.GetOrgId())
	}

	if _, err := client.GetCustomerModelPricing(context.Background(), &GetCustomerModelPricingParams{OrgID: "acme"}); err != nil {
		t.Fatalf("GetCustomerModelPricing: %v", err)
	}
	if fake.pricingIn.GetOrgId() != "acme" {
		t.Errorf("OrgId = %q, want acme", fake.pricingIn.GetOrgId())
	}
}

func TestBillingListModelPricingBaselines_NilParamsMeansActiveOnly(t *testing.T) {
	fake := &fakeBillingQuery{}
	client := &BillingClient{query: fake}

	if _, err := client.ListModelPricingBaselines(context.Background(), nil); err != nil {
		t.Fatalf("ListModelPricingBaselines: %v", err)
	}
	if fake.listIn.GetIncludeHistory() {
		t.Error("IncludeHistory = true, want false for nil params")
	}

	if _, err := client.ListModelPricingBaselines(context.Background(), &ListModelPricingBaselinesParams{IncludeHistory: true}); err != nil {
		t.Fatalf("ListModelPricingBaselines: %v", err)
	}
	if !fake.listIn.GetIncludeHistory() {
		t.Error("IncludeHistory = false, want true")
	}
}

func TestBillingRetireModelPricingBaseline_MapsKey(t *testing.T) {
	fake := &fakeBillingCommand{}
	client := &BillingClient{command: fake}

	if _, err := client.RetireModelPricingBaseline(context.Background(), &RetireModelPricingBaselineParams{
		ModelID:      "claude-sonnet-4.5",
		Provider:     "anthropic",
		Harness:      "native",
		RevisionNote: "deprecated upstream",
	}); err != nil {
		t.Fatalf("RetireModelPricingBaseline: %v", err)
	}

	in := fake.retireIn
	if in.GetModelId() != "claude-sonnet-4.5" || in.GetProvider() != "anthropic" || in.GetHarness() != "native" {
		t.Errorf("key = (%q, %q, %q)", in.GetModelId(), in.GetProvider(), in.GetHarness())
	}
	if in.GetRevisionNote() != "deprecated upstream" {
		t.Errorf("RevisionNote = %q", in.GetRevisionNote())
	}
}
