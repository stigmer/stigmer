package mcpserver

// Pins the read-time oauth_status enrichment (stigmer/stigmer#523): get and
// getByReference copy vendor_approval_status/vendor_approval_docs_url from
// the referenced OAuthApp onto status.oauth_status, byte-mirroring the
// cloud's McpServerVendorApprovalEnricher semantics so the shared SDK's
// blocked-state UI (useMcpServerCredentials.isVendorApprovalBlocked) behaves
// identically on both editions. No cloud test pins the enricher, so this
// table is the executable spec of the shared contract — change it only in
// lockstep with the Java side.

import (
	"context"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const (
	enrichTestOAuthAppSlug = "enrich-vendor-app"
	enrichTestDocsURL      = "https://docs.example.com/byoa-setup"
)

// saveEnrichmentOAuthApp stores an OAuthApp fixture the enrichment tests
// reference by slug, carrying the given vendor approval state.
func saveEnrichmentOAuthApp(
	t *testing.T,
	s store.Store,
	approval oauthappv1.VendorApprovalStatus,
	docsURL string,
) {
	t.Helper()

	app := &oauthappv1.OAuthApp{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "oauthapp-enrich-test",
			Name: "Enrich Vendor App",
			Slug: enrichTestOAuthAppSlug,
			Org:  "test-org",
		},
		Spec: &oauthappv1.OAuthAppSpec{
			Provider:              "EnrichVendor",
			ClientId:              "client-enrich",
			AuthorizationUrl:      "https://vendor.example.com/oauth/authorize",
			TokenUrl:              "https://vendor.example.com/oauth/token",
			VendorApprovalStatus:  approval,
			VendorApprovalDocsUrl: docsURL,
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_oauth_app, app.GetMetadata().GetId(), app); err != nil {
		t.Fatalf("failed to save oauth app fixture: %v", err)
	}
}

// saveEnrichmentMcpServer stores an McpServer fixture with the given auth
// block, bypassing the create pipeline so the test controls metadata exactly.
func saveEnrichmentMcpServer(
	t *testing.T,
	s store.Store,
	auth *mcpserverv1.McpServerAuth,
) *mcpserverv1.McpServer {
	t.Helper()

	mcpServer := createTestMcpServer("enrich-test-server")
	mcpServer.Metadata.Id = "mcpserver-enrich-test"
	mcpServer.Metadata.Slug = "enrich-test-server"
	mcpServer.Spec.Auth = auth
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, mcpServer.GetMetadata().GetId(), mcpServer); err != nil {
		t.Fatalf("failed to save mcp server fixture: %v", err)
	}
	return mcpServer
}

// vendorOAuthAuthBlock returns an auth block referencing the test OAuthApp.
func vendorOAuthAuthBlock(slug string) *mcpserverv1.McpServerAuth {
	return &mcpserverv1.McpServerAuth{
		OauthAppRef:  &apiresource.ApiResourceReference{Slug: slug},
		TargetEnvVar: "VENDOR_TOKEN",
	}
}

func TestGetEnrichesOAuthStatus(t *testing.T) {
	tests := []struct {
		name string
		// nil means "do not save an OAuthApp fixture"
		approval *oauthappv1.VendorApprovalStatus
		docsURL  string
		auth     *mcpserverv1.McpServerAuth

		wantEnriched bool
		wantStatus   oauthappv1.VendorApprovalStatus
		wantDocsURL  string
	}{
		{
			name:         "pending approval populates status and docs url",
			approval:     approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING),
			docsURL:      enrichTestDocsURL,
			auth:         vendorOAuthAuthBlock(enrichTestOAuthAppSlug),
			wantEnriched: true,
			wantStatus:   oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING,
			wantDocsURL:  enrichTestDocsURL,
		},
		{
			name:         "rejected approval populates status without docs url",
			approval:     approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_REJECTED),
			docsURL:      "",
			auth:         vendorOAuthAuthBlock(enrichTestOAuthAppSlug),
			wantEnriched: true,
			wantStatus:   oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_REJECTED,
			wantDocsURL:  "",
		},
		{
			name:         "approved status is still reported",
			approval:     approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_APPROVED),
			docsURL:      enrichTestDocsURL,
			auth:         vendorOAuthAuthBlock(enrichTestOAuthAppSlug),
			wantEnriched: true,
			wantStatus:   oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_APPROVED,
			wantDocsURL:  enrichTestDocsURL,
		},
		{
			name:         "unspecified status with docs url is reported",
			approval:     approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_UNSPECIFIED),
			docsURL:      enrichTestDocsURL,
			auth:         vendorOAuthAuthBlock(enrichTestOAuthAppSlug),
			wantEnriched: true,
			wantStatus:   oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_UNSPECIFIED,
			wantDocsURL:  enrichTestDocsURL,
		},
		{
			name:         "unspecified status with no docs url leaves oauth_status absent",
			approval:     approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_UNSPECIFIED),
			docsURL:      "",
			auth:         vendorOAuthAuthBlock(enrichTestOAuthAppSlug),
			wantEnriched: false,
		},
		{
			name:         "server without auth block is untouched",
			approval:     approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING),
			docsURL:      enrichTestDocsURL,
			auth:         nil,
			wantEnriched: false,
		},
		{
			name:     "DCR server (auth without oauth_app_ref) is untouched",
			approval: approvalPtr(oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING),
			docsURL:  enrichTestDocsURL,
			auth: &mcpserverv1.McpServerAuth{
				TargetEnvVar: "DCR_TOKEN",
			},
			wantEnriched: false,
		},
		{
			name:         "ref to missing oauth app is untouched",
			approval:     nil,
			auth:         vendorOAuthAuthBlock("no-such-app"),
			wantEnriched: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			controller, s := setupTestController(t)
			if tt.approval != nil {
				saveEnrichmentOAuthApp(t, s, *tt.approval, tt.docsURL)
			}
			saved := saveEnrichmentMcpServer(t, s, tt.auth)

			got, err := controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: saved.GetMetadata().GetId()})
			if err != nil {
				t.Fatalf("Get failed: %v", err)
			}

			assertOAuthStatus(t, got, tt.wantEnriched, tt.wantStatus, tt.wantDocsURL)
		})
	}
}

func TestGetByReferenceEnrichesOAuthStatus(t *testing.T) {
	controller, s := setupTestController(t)
	saveEnrichmentOAuthApp(t, s, oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING, enrichTestDocsURL)
	saved := saveEnrichmentMcpServer(t, s, vendorOAuthAuthBlock(enrichTestOAuthAppSlug))

	got, err := controller.GetByReference(contextWithMcpServerKind(), &apiresource.ApiResourceReference{
		Slug: saved.GetMetadata().GetSlug(),
		Org:  saved.GetMetadata().GetOrg(),
	})
	if err != nil {
		t.Fatalf("GetByReference failed: %v", err)
	}

	assertOAuthStatus(t, got,
		true,
		oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING,
		enrichTestDocsURL,
	)
}

// TestEnrichmentIsResponseOnly pins the OAuthStatus proto contract that the
// enriched fields are never persisted: after an enriched read, the stored
// McpServer must still carry no oauth_status.
func TestEnrichmentIsResponseOnly(t *testing.T) {
	controller, s := setupTestController(t)
	saveEnrichmentOAuthApp(t, s, oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING, enrichTestDocsURL)
	saved := saveEnrichmentMcpServer(t, s, vendorOAuthAuthBlock(enrichTestOAuthAppSlug))

	got, err := controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: saved.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.GetStatus().GetOauthStatus() == nil {
		t.Fatal("expected the Get response to be enriched")
	}

	stored := &mcpserverv1.McpServer{}
	if err := s.GetResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, saved.GetMetadata().GetId(), stored); err != nil {
		t.Fatalf("failed to reload stored mcp server: %v", err)
	}
	if stored.GetStatus().GetOauthStatus() != nil {
		t.Errorf("oauth_status leaked into the store: %v", stored.GetStatus().GetOauthStatus())
	}
}

// TestInitiateAndEnrichmentResolveSameApp pins that the enricher and the
// initiate path share one OAuthApp resolution (resolveOAuthAppByRef): a ref
// carrying an org must resolve to that org's app for both.
func TestInitiateAndEnrichmentResolveSameApp(t *testing.T) {
	controller, s := setupTestController(t)

	// Two apps share a slug across orgs; the ref pins org "org-b".
	for _, fixture := range []struct {
		id, org  string
		approval oauthappv1.VendorApprovalStatus
	}{
		{"oauthapp-org-a", "org-a", oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_APPROVED},
		{"oauthapp-org-b", "org-b", oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING},
	} {
		app := &oauthappv1.OAuthApp{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   fixture.id,
				Name: "Shared Slug App",
				Slug: "shared-slug",
				Org:  fixture.org,
			},
			Spec: &oauthappv1.OAuthAppSpec{
				Provider:             "SharedVendor",
				ClientId:             "client-" + fixture.org,
				AuthorizationUrl:     "https://vendor.example.com/oauth/authorize",
				TokenUrl:             "https://vendor.example.com/oauth/token",
				VendorApprovalStatus: fixture.approval,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_oauth_app, app.GetMetadata().GetId(), app); err != nil {
			t.Fatalf("failed to save oauth app fixture: %v", err)
		}
	}

	saved := saveEnrichmentMcpServer(t, s, &mcpserverv1.McpServerAuth{
		OauthAppRef: &apiresource.ApiResourceReference{
			Slug: "shared-slug",
			Org:  "org-b",
		},
		TargetEnvVar: "VENDOR_TOKEN",
	})

	got, err := controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: saved.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	assertOAuthStatus(t, got,
		true,
		oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING,
		"",
	)
}

func approvalPtr(v oauthappv1.VendorApprovalStatus) *oauthappv1.VendorApprovalStatus {
	return &v
}

func assertOAuthStatus(
	t *testing.T,
	got *mcpserverv1.McpServer,
	wantEnriched bool,
	wantStatus oauthappv1.VendorApprovalStatus,
	wantDocsURL string,
) {
	t.Helper()

	oauthStatus := got.GetStatus().GetOauthStatus()
	if !wantEnriched {
		if oauthStatus != nil {
			t.Errorf("expected oauth_status to be absent, got %v", oauthStatus)
		}
		return
	}

	want := &mcpserverv1.OAuthStatus{
		VendorApprovalStatus:  wantStatus,
		VendorApprovalDocsUrl: wantDocsURL,
	}
	if !proto.Equal(oauthStatus, want) {
		t.Errorf("oauth_status mismatch:\n  got:  %v\n  want: %v", oauthStatus, want)
	}
}
