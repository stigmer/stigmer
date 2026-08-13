package mcpserver

import (
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestOrgOAuthAppSurface_UnimplementedByDesign pins the edition scoping of
// the org-OAuth-app (BYOA override) surface: getOrgOAuthApp, setOrgOAuthApp,
// and deleteOrgOAuthApp answer UNIMPLEMENTED on OSS — deliberately, not as
// an oversight (stigmer/stigmer#558, DD-019 in the triage project).
//
// Why the surface cannot exist here: an OAuthAppOverride binds an org's own
// OAuthApp OVER a platform-managed default. OSS has no platform operator
// distinct from the user — the flat oauthapp domain gives the user full CRUD
// over the very apps a hosted org could only override — and the OSS OAuth
// resolution (the oauthapp refresolution package) has no override level to consult: the
// ref IS the whole resolution. Cloud's setOrgOAuthApp additionally clones
// endpoint URLs from the platform template, which OSS installs do not ship.
//
// The three RPCs are ONE capability. The shared SDK probes it via
// getOrgOAuthApp and hides every BYOA affordance when the probe answers
// UNIMPLEMENTED (useOrgOAuthApp.isSupported). Implementing any one RPC
// without the other two — e.g. a "truthful" read returning
// has_override=false — would break the probe and resurrect dead affordances
// on OSS. If this surface is ever brought to OSS, all three RPCs, the OSS
// resolution chain, and the SDK gate must move together; until then this
// test is the guard. See the RPC doc comments in query.proto/command.proto.
func TestOrgOAuthAppSurface_UnimplementedByDesign(t *testing.T) {
	controller, _ := setupTestController(t)
	ctx := contextWithMcpServerKind()

	t.Run("getOrgOAuthApp", func(t *testing.T) {
		_, err := controller.GetOrgOAuthApp(ctx, &mcpserverv1.GetOrgOAuthAppInput{
			ResourceId: "mcps_test",
			Org:        "test-org",
		})
		assertUnimplemented(t, err)
	})

	t.Run("setOrgOAuthApp", func(t *testing.T) {
		_, err := controller.SetOrgOAuthApp(ctx, &mcpserverv1.SetOrgOAuthAppInput{
			ResourceId:   "mcps_test",
			Org:          "test-org",
			ClientId:     "client-id",
			ClientSecret: "client-secret",
		})
		assertUnimplemented(t, err)
	})

	t.Run("deleteOrgOAuthApp", func(t *testing.T) {
		_, err := controller.DeleteOrgOAuthApp(ctx, &mcpserverv1.DeleteOrgOAuthAppInput{
			ResourceId: "mcps_test",
			Org:        "test-org",
		})
		assertUnimplemented(t, err)
	})
}

func assertUnimplemented(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected UNIMPLEMENTED, got nil error — if this RPC was implemented on purpose, the whole org-OAuth-app surface and the SDK capability gate must move together (see test doc comment)")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected a gRPC status error, got: %v", err)
	}
	if st.Code() != codes.Unimplemented {
		t.Fatalf("expected codes.Unimplemented, got %v: %v", st.Code(), err)
	}
}
