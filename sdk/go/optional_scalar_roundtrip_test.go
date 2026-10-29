package stigmer

// The generated toProto of a nested input whose message holds proto3
// optional scalars (EntitlementLimits, PlanTerms) carries every one of them:
// a literal form that skips synthetic-oneof fields would keep a Go caller's
// plan limits and prices off the wire. These tests drive the
// checked-in generated code through PlanClient.Create against an
// in-memory server and read the exact wire message. They live at the SDK
// root because internal/gen is wiped and regenerated wholesale.
//
// A Go input field is a plain value, so its zero reads as unset: a limit or
// a price the caller leaves at zero stays absent on the wire, which is what
// "absent is no limit" and "absent on a license plan" ask for.

import (
	"context"
	"net"
	"testing"

	"go.stigmer.ai/sdk/internal/gen"
	planv1 "go.stigmer.ai/sdk/proto/ai/stigmer/billing/plan/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type planCaptureServer struct {
	planv1.UnimplementedPlanCommandControllerServer
	lastPlan *planv1.Plan
}

func (s *planCaptureServer) Create(_ context.Context, req *planv1.Plan) (*planv1.Plan, error) {
	s.lastPlan = req
	return req, nil
}

func newPlanCaptureClient(t *testing.T) (*PlanClient, *planCaptureServer) {
	t.Helper()

	capture := &planCaptureServer{}
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	planv1.RegisterPlanCommandControllerServer(srv, capture)

	go func() { _ = srv.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
	)
	if err != nil {
		t.Fatalf("grpc.NewClient: %v", err)
	}

	t.Cleanup(func() {
		_ = conn.Close()
		srv.Stop()
		_ = lis.Close()
	})

	return gen.NewPlanClient(conn), capture
}

func TestPlanCreate_SendsTheLimitsTheCallerSet(t *testing.T) {
	client, capture := newPlanCaptureClient(t)

	_, err := client.Create(context.Background(), &PlanInput{
		Name:       "Team",
		Instrument: planv1.PlanInstrument_subscription,
		Entitlements: &EntitlementsInput{
			Limits: &EntitlementLimitsInput{
				MaxOrgs:                        5,
				MaxActiveSessionSandboxes:      8,
				ArchivedWorkspaceRetentionDays: 30,
			},
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	limits := capture.lastPlan.GetSpec().GetEntitlements().GetLimits()
	if limits == nil {
		t.Fatal("limits absent on the wire")
	}
	if limits.MaxOrgs == nil || limits.GetMaxOrgs() != 5 {
		t.Errorf("max_orgs = %v, want 5", limits.MaxOrgs)
	}
	if limits.MaxActiveSessionSandboxes == nil || limits.GetMaxActiveSessionSandboxes() != 8 {
		t.Errorf("max_active_session_sandboxes = %v, want 8", limits.MaxActiveSessionSandboxes)
	}
	if limits.ArchivedWorkspaceRetentionDays == nil || limits.GetArchivedWorkspaceRetentionDays() != 30 {
		t.Errorf("archived_workspace_retention_days = %v, want 30", limits.ArchivedWorkspaceRetentionDays)
	}
	if limits.MaxUsers != nil {
		t.Errorf("max_users = %d, want absent (the caller never set it)", limits.GetMaxUsers())
	}
	if limits.IncludedChildOrgs != nil {
		t.Errorf("included_child_orgs = %d, want absent", limits.GetIncludedChildOrgs())
	}
}

func TestPlanCreate_SendsThePricesTheCallerSet(t *testing.T) {
	client, capture := newPlanCaptureClient(t)

	_, err := client.Create(context.Background(), &PlanInput{
		Name:       "Team",
		Instrument: planv1.PlanInstrument_subscription,
		Terms: &PlanTermsInput{
			MonthlyMinimumMicros: 20_000_000,
			PerExtraOrgMicros:    25_000_000,
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	terms := capture.lastPlan.GetSpec().GetTerms()
	if terms == nil {
		t.Fatal("terms absent on the wire")
	}
	if terms.MonthlyMinimumMicros == nil || terms.GetMonthlyMinimumMicros() != 20_000_000 {
		t.Errorf("monthly_minimum_micros = %v, want 20000000", terms.MonthlyMinimumMicros)
	}
	if terms.PerExtraOrgMicros == nil || terms.GetPerExtraOrgMicros() != 25_000_000 {
		t.Errorf("per_extra_org_micros = %v, want 25000000", terms.PerExtraOrgMicros)
	}
	if terms.AnnualPriceMicros != nil {
		t.Errorf("annual_price_micros = %d, want absent on a subscription plan", terms.GetAnnualPriceMicros())
	}
}
