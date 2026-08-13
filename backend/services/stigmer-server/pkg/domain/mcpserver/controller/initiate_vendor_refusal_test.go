package mcpserver

// Tests for the vendor-approval refusal message on InitiateOAuthConnect
// (stigmer/stigmer#412): the suggested alternative must be one that can
// actually work. oauth_only endpoints reject static tokens, so the refusal
// must steer those users to BYOA, never to manual token entry.
//
// This refusal is the enforcement boundary for the blocked state. Since
// stigmer/stigmer#523 the read pipelines also enrich status.oauth_status
// (see enrich_oauth_status.go), so the SDK's blocked notice normally
// pre-empts the click — this message remains the backstop for clients that
// initiate anyway (stale reads, non-SDK callers).

import (
	"context"
	"strings"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// saveBlockedVendorFixtures stores an OAuthApp with the given vendor approval
// status and an McpServer whose auth block references it, with oauth_only set
// per the case under test. Returns the McpServer ID.
func saveBlockedVendorFixtures(
	t *testing.T,
	h *oauthSecretsHarness,
	approval oauthappv1.VendorApprovalStatus,
	oauthOnly bool,
) string {
	t.Helper()
	ctx := context.Background()

	app := &oauthappv1.OAuthApp{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "oauthapp-blockedvendor",
			Name: "Blocked Vendor",
			Slug: "blocked-vendor",
			Org:  "test-org",
		},
		Spec: &oauthappv1.OAuthAppSpec{
			Provider:             "BlockedVendor",
			ClientId:             "client-456",
			ClientSecret:         h.secrets.MustEncrypt("irrelevant"),
			AuthorizationUrl:     "https://vendor.example.com/oauth/authorize",
			TokenUrl:             "https://vendor.example.com/oauth/token",
			VendorApprovalStatus: approval,
		},
	}
	if err := h.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_oauth_app, app.GetMetadata().GetId(), app); err != nil {
		t.Fatalf("failed to save oauth app: %v", err)
	}

	mcpServerID := "mcpserver-blocked-vendor-test"
	mcpServer := createTestMcpServer("blocked-vendor-server")
	mcpServer.Metadata.Id = mcpServerID
	mcpServer.Spec.Auth = &mcpserverv1.McpServerAuth{
		OauthAppRef:  &apiresource.ApiResourceReference{Slug: "blocked-vendor"},
		TargetEnvVar: "VENDOR_TOKEN",
		OauthOnly:    oauthOnly,
	}
	if err := h.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		t.Fatalf("failed to save mcp server: %v", err)
	}

	return mcpServerID
}

func TestInitiateVendorOAuth_BlockedRefusalSuggestsAWorkablePath(t *testing.T) {
	const manualAlternative = "Please enter a token manually instead."
	const byoaAlternative = "an org admin can configure your own OAuth app instead"

	cases := []struct {
		name        string
		approval    oauthappv1.VendorApprovalStatus
		oauthOnly   bool
		statusLabel string
		wantPart    string
		refusePart  string
	}{
		{
			name:        "pending + PAT-capable suggests manual entry",
			approval:    oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING,
			oauthOnly:   false,
			statusLabel: "pending approval",
			wantPart:    manualAlternative,
			refusePart:  byoaAlternative,
		},
		{
			name:        "pending + oauth_only suggests BYOA, never manual entry",
			approval:    oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING,
			oauthOnly:   true,
			statusLabel: "pending approval",
			wantPart:    byoaAlternative,
			refusePart:  manualAlternative,
		},
		{
			name:        "rejected + PAT-capable suggests manual entry",
			approval:    oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_REJECTED,
			oauthOnly:   false,
			statusLabel: "rejected",
			wantPart:    manualAlternative,
			refusePart:  byoaAlternative,
		},
		{
			name:        "rejected + oauth_only suggests BYOA, never manual entry",
			approval:    oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_REJECTED,
			oauthOnly:   true,
			statusLabel: "rejected",
			wantPart:    byoaAlternative,
			refusePart:  manualAlternative,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			secrets, err := encryption.NewSecretService(oauthSecretsTestKey)
			if err != nil {
				t.Fatalf("failed to create secret service: %v", err)
			}
			h := setupOAuthSecretsHarness(t, secrets)
			mcpServerID := saveBlockedVendorFixtures(t, h, tc.approval, tc.oauthOnly)

			_, err = h.controller.InitiateOAuthConnect(context.Background(), &mcpserverv1.InitiateOAuthConnectInput{
				McpServerId: mcpServerID,
				Org:         "test-org",
			})
			if err == nil {
				t.Fatal("InitiateOAuthConnect must refuse a vendor-blocked app")
			}

			msg := err.Error()
			if !strings.Contains(msg, tc.statusLabel) {
				t.Errorf("refusal must name the approval state %q, got: %s", tc.statusLabel, msg)
			}
			if !strings.Contains(msg, tc.wantPart) {
				t.Errorf("refusal must suggest %q, got: %s", tc.wantPart, msg)
			}
			if strings.Contains(msg, tc.refusePart) {
				t.Errorf("refusal must not suggest %q (dead path), got: %s", tc.refusePart, msg)
			}
		})
	}
}
