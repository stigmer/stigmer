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

	billingv1 "go.stigmer.ai/sdk/proto/ai/stigmer/billing/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fakeBillingCommand captures requests to the command controller. Only the
// RPCs exercised by tests are implemented with capture-and-respond bodies;
// the server-internal metering RPC returns nil because the SDK never calls it.
type fakeBillingCommand struct {
	billingv1.BillingCommandControllerClient

	accountIn  *billingv1.GetOrCreateBillingAccountInput
	accountErr error

	setupIn  *billingv1.CreatePaymentMethodSetupSessionInput
	retireIn *billingv1.RetireModelPricingBaselineInput
}

func (f *fakeBillingCommand) GetOrCreateBillingAccount(_ context.Context, in *billingv1.GetOrCreateBillingAccountInput, _ ...grpc.CallOption) (*billingv1.BillingAccount, error) {
	f.accountIn = in
	if f.accountErr != nil {
		return nil, f.accountErr
	}
	return &billingv1.BillingAccount{}, nil
}

func (f *fakeBillingCommand) CreatePaymentMethodSetupSession(_ context.Context, in *billingv1.CreatePaymentMethodSetupSessionInput, _ ...grpc.CallOption) (*billingv1.CreatePaymentMethodSetupSessionResponse, error) {
	f.setupIn = in
	return &billingv1.CreatePaymentMethodSetupSessionResponse{}, nil
}

func (f *fakeBillingCommand) RetireModelPricingBaseline(_ context.Context, in *billingv1.RetireModelPricingBaselineInput, _ ...grpc.CallOption) (*billingv1.ModelPricingBaseline, error) {
	f.retireIn = in
	return &billingv1.ModelPricingBaseline{}, nil
}

// fakeBillingQuery captures requests to the query controller.
type fakeBillingQuery struct {
	billingv1.BillingQueryControllerClient

	listIn *billingv1.ListModelPricingBaselinesInput
}

func (f *fakeBillingQuery) ListModelPricingBaselines(_ context.Context, in *billingv1.ListModelPricingBaselinesInput, _ ...grpc.CallOption) (*billingv1.ModelPricingBaselinesResponse, error) {
	f.listIn = in
	return &billingv1.ModelPricingBaselinesResponse{}, nil
}

func TestBillingGetOrCreateBillingAccount_MapsOrg(t *testing.T) {
	fake := &fakeBillingCommand{}
	client := &BillingClient{command: fake}

	if _, err := client.GetOrCreateBillingAccount(context.Background(), "acme"); err != nil {
		t.Fatalf("GetOrCreateBillingAccount: %v", err)
	}
	if fake.accountIn.GetOrg() != "acme" {
		t.Errorf("Org = %q, want acme", fake.accountIn.GetOrg())
	}
}

func TestBillingGetOrCreateBillingAccount_WrapsGRPCError(t *testing.T) {
	fake := &fakeBillingCommand{
		accountErr: status.Error(codes.PermissionDenied, "can_manage_billing required"),
	}
	client := &BillingClient{command: fake}

	_, err := client.GetOrCreateBillingAccount(context.Background(), "acme")
	var sdkErr *Error
	if !errors.As(err, &sdkErr) {
		t.Fatalf("error = %v (%T), want *stigmer.Error", err, err)
	}
	if sdkErr.GRPCCode != codes.PermissionDenied {
		t.Errorf("GRPCCode = %v, want PermissionDenied", sdkErr.GRPCCode)
	}
}

func TestBillingCreatePaymentMethodSetupSession_MapsParams(t *testing.T) {
	fake := &fakeBillingCommand{}
	client := &BillingClient{command: fake}

	if _, err := client.CreatePaymentMethodSetupSession(context.Background(), &CreatePaymentMethodSetupSessionParams{
		Org:        "acme",
		SuccessURL: "https://app.example.com/billing?setup=success",
		CancelURL:  "https://app.example.com/billing",
	}); err != nil {
		t.Fatalf("CreatePaymentMethodSetupSession: %v", err)
	}

	in := fake.setupIn
	if in.GetOrg() != "acme" {
		t.Errorf("Org = %q, want acme", in.GetOrg())
	}
	if in.GetSuccessUrl() != "https://app.example.com/billing?setup=success" || in.GetCancelUrl() != "https://app.example.com/billing" {
		t.Errorf("urls = (%q, %q)", in.GetSuccessUrl(), in.GetCancelUrl())
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
		Harness:      "stigmer",
		RevisionNote: "deprecated upstream",
	}); err != nil {
		t.Fatalf("RetireModelPricingBaseline: %v", err)
	}

	in := fake.retireIn
	if in.GetModelId() != "claude-sonnet-4.5" || in.GetProvider() != "anthropic" || in.GetHarness() != "stigmer" {
		t.Errorf("key = (%q, %q, %q)", in.GetModelId(), in.GetProvider(), in.GetHarness())
	}
	if in.GetRevisionNote() != "deprecated upstream" {
		t.Errorf("RevisionNote = %q", in.GetRevisionNote())
	}
}
