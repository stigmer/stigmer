package identityprovider

import (
	"fmt"
	"strings"

	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays an identity provider in the specified format.
func DisplayGetResult(idp *identityproviderv1.IdentityProvider, format string) {
	display.DisplayProto(idp, format, func() { displayTable(idp) })
}

func displayTable(idp *identityproviderv1.IdentityProvider) {
	fmt.Println()
	fmt.Printf("IdentityProvider: %s\n", idp.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", idp.Metadata.Id)
	fmt.Printf("  Name:        %s\n", idp.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", idp.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", idp.Metadata.Org)
	fmt.Println()

	fmt.Printf("Spec:\n")
	if idp.Spec != nil {
		if idp.Spec.DisplayName != "" {
			fmt.Printf("  Display Name:      %s\n", idp.Spec.DisplayName)
		}
		if idp.Spec.JwksUri != "" {
			fmt.Printf("  JWKS URI:          %s\n", idp.Spec.JwksUri)
		}
		if len(idp.Spec.AllowedIssuers) > 0 {
			fmt.Printf("  Allowed Issuers:   %s\n", strings.Join(idp.Spec.AllowedIssuers, ", "))
		}
		if idp.Spec.ExpectedAudience != "" {
			fmt.Printf("  Expected Audience: %s\n", idp.Spec.ExpectedAudience)
		}
		if idp.Spec.IsSsoProvider {
			fmt.Printf("  SSO Provider:      true\n")
			if idp.Spec.OidcClientId != "" {
				fmt.Printf("  OIDC Client ID:    %s\n", idp.Spec.OidcClientId)
			}
		}
		if idp.Spec.UserinfoEndpoint != "" {
			fmt.Printf("  UserInfo Endpoint: %s\n", idp.Spec.UserinfoEndpoint)
		}
	}
	fmt.Println()
}
