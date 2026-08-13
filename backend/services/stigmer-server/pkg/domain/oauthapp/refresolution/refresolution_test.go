package refresolution

// The executable spec of the ref-resolution semantics (stigmer/stigmer#584):
// exact (org, slug) match wins; a slug-only match is honored only when
// unique; ambiguity resolves to nothing. Every consumer (initiate, status
// enricher, token refresh, delete guard) inherits exactly this table.

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// app is a (org, slug) fixture; the id doubles as the assertion handle.
type app struct {
	id, org, slug string
}

func newStoreWithApps(t *testing.T, apps []app) store.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	for _, a := range apps {
		fixture := &oauthappv1.OAuthApp{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   a.id,
				Name: a.id,
				Slug: a.slug,
				Org:  a.org,
			},
			Spec: &oauthappv1.OAuthAppSpec{
				Provider: "TestVendor",
				ClientId: "client-" + a.id,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_oauth_app, a.id, fixture); err != nil {
			t.Fatalf("failed to save oauth app fixture %s: %v", a.id, err)
		}
	}
	return s
}

func TestResolve(t *testing.T) {
	tests := []struct {
		name string
		apps []app
		ref  *apiresource.ApiResourceReference
		// wantID "" means "resolves to nothing".
		wantID string
	}{
		{
			name:   "exact org+slug match wins over another org's same slug",
			apps:   []app{{"app-a", "org-a", "github-oauth"}, {"app-b", "org-b", "github-oauth"}},
			ref:    &apiresource.ApiResourceReference{Org: "org-b", Slug: "github-oauth"},
			wantID: "app-b",
		},
		{
			// The seedpack journey: the ref pins the hosted platform's org,
			// the only matching app lives in the self-hosted user's own org.
			name:   "org miss falls back to the unique slug match",
			apps:   []app{{"app-user", "acme", "github-oauth"}},
			ref:    &apiresource.ApiResourceReference{Org: "stigmer", Slug: "github-oauth"},
			wantID: "app-user",
		},
		{
			name:   "org miss with two slug matches is ambiguous and resolves to nothing",
			apps:   []app{{"app-a", "org-a", "github-oauth"}, {"app-b", "org-b", "github-oauth"}},
			ref:    &apiresource.ApiResourceReference{Org: "stigmer", Slug: "github-oauth"},
			wantID: "",
		},
		{
			name:   "org-less ref with a unique slug match resolves",
			apps:   []app{{"app-a", "org-a", "github-oauth"}},
			ref:    &apiresource.ApiResourceReference{Slug: "github-oauth"},
			wantID: "app-a",
		},
		{
			name:   "org-less ref with two slug matches is ambiguous and resolves to nothing",
			apps:   []app{{"app-a", "org-a", "github-oauth"}, {"app-b", "org-b", "github-oauth"}},
			ref:    &apiresource.ApiResourceReference{Slug: "github-oauth"},
			wantID: "",
		},
		{
			name:   "no slug match resolves to nothing",
			apps:   []app{{"app-a", "org-a", "slack-oauth"}},
			ref:    &apiresource.ApiResourceReference{Org: "org-a", Slug: "github-oauth"},
			wantID: "",
		},
		{
			name:   "ref without a slug resolves to nothing even with apps stored",
			apps:   []app{{"app-a", "org-a", "github-oauth"}},
			ref:    &apiresource.ApiResourceReference{Org: "org-a"},
			wantID: "",
		},
		{
			name:   "nil ref resolves to nothing",
			apps:   []app{{"app-a", "org-a", "github-oauth"}},
			ref:    nil,
			wantID: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newStoreWithApps(t, tt.apps)

			got, err := Resolve(context.Background(), s, tt.ref)
			if err != nil {
				t.Fatalf("Resolve failed: %v", err)
			}

			gotID := got.GetMetadata().GetId()
			if gotID != tt.wantID {
				t.Errorf("Resolve picked %q, want %q", gotID, tt.wantID)
			}
		})
	}
}
