package oauthapp

// Pins the delete guard's "referenced means RESOLVES to" semantics
// (stigmer/stigmer#584): deletion is blocked exactly when some McpServer's
// oauth_app_ref resolves to the app under the shared refresolution
// semantics — including through the unique-slug fallback — and is NOT
// blocked by a literal field match whose resolution lands on another app.

import (
	"context"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// saveReferencingMcpServer stores an McpServer whose auth block carries the
// given oauth_app_ref, bypassing the create pipeline so the test controls
// the ref exactly.
func saveReferencingMcpServer(t *testing.T, s store.Store, id string, ref *apiresource.ApiResourceReference) {
	t.Helper()
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: id,
			Slug: id,
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Referencing server for delete-guard tests",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{Url: "https://mcp.example.com/"},
			},
			Auth: &mcpserverv1.McpServerAuth{
				OauthAppRef:  ref,
				TargetEnvVar: "VENDOR_TOKEN",
			},
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, id, mcpServer); err != nil {
		t.Fatalf("failed to save mcp server fixture: %v", err)
	}
}

func mustCreateApp(t *testing.T, h *testHarness, name, org string) *oauthappv1.OAuthApp {
	t.Helper()
	created, err := h.controller.Create(appCtx(), newOAuthApp(name, org))
	if err != nil {
		t.Fatalf("create %s/%s failed: %v", org, name, err)
	}
	return created
}

func deleteApp(h *testHarness, id string) error {
	_, err := h.controller.Delete(appCtx(), &apiresource.ApiResourceDeleteInput{ResourceId: id})
	return err
}

func TestDeleteBlockedByExactReference(t *testing.T) {
	h := newTestHarness(t)
	app := mustCreateApp(t, h, "GitHub OAuth", "acme")
	saveReferencingMcpServer(t, h.store, "mcps-exact", &apiresource.ApiResourceReference{
		Org: "acme", Slug: app.GetMetadata().GetSlug(),
	})

	if err := deleteApp(h, app.GetMetadata().GetId()); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for exactly-referenced app, got %v", err)
	}
}

// The seedpack journey: the ref pins another org (the hosted platform's),
// but resolution reaches this app through the unique-slug fallback — so
// deleting it would sever a live vendor-OAuth connection.
func TestDeleteBlockedByFallbackReference(t *testing.T) {
	h := newTestHarness(t)
	app := mustCreateApp(t, h, "GitHub OAuth", "acme")
	saveReferencingMcpServer(t, h.store, "mcps-fallback", &apiresource.ApiResourceReference{
		Org: "stigmer", Slug: app.GetMetadata().GetSlug(),
	})

	if err := deleteApp(h, app.GetMetadata().GetId()); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for fallback-referenced app, got %v", err)
	}
}

// With two same-slug apps, the ref exact-resolves to one; the OTHER app is
// not what the ref means and must stay deletable (the pre-#584 literal
// field match got this right only by accident of requiring org equality —
// this pins it against the resolution-based guard).
func TestDeleteOfShadowedSameSlugAppSucceeds(t *testing.T) {
	h := newTestHarness(t)
	resolved := mustCreateApp(t, h, "GitHub OAuth", "stigmer")
	shadowed := mustCreateApp(t, h, "GitHub OAuth", "acme")
	saveReferencingMcpServer(t, h.store, "mcps-pinned", &apiresource.ApiResourceReference{
		Org: "stigmer", Slug: resolved.GetMetadata().GetSlug(),
	})

	if err := deleteApp(h, shadowed.GetMetadata().GetId()); err != nil {
		t.Fatalf("expected delete of the non-resolved same-slug app to succeed, got %v", err)
	}
	if err := deleteApp(h, resolved.GetMetadata().GetId()); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for the exactly-resolved app, got %v", err)
	}
}

func TestDeleteOfUnreferencedAppSucceeds(t *testing.T) {
	h := newTestHarness(t)
	app := mustCreateApp(t, h, "Unreferenced App", "acme")
	saveReferencingMcpServer(t, h.store, "mcps-other", &apiresource.ApiResourceReference{
		Org: "acme", Slug: "some-other-app",
	})

	if err := deleteApp(h, app.GetMetadata().GetId()); err != nil {
		t.Fatalf("expected delete of unreferenced app to succeed, got %v", err)
	}
}
