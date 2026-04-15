package oauthapp

import (
	"fmt"
	"strings"

	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays an OAuth app in the specified format.
func DisplayGetResult(app *oauthappv1.OAuthApp, format string) {
	display.DisplayProto(app, format, func() { displayTable(app) })
}

func displayTable(app *oauthappv1.OAuthApp) {
	fmt.Println()
	fmt.Printf("OAuthApp: %s\n", app.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", app.Metadata.Id)
	fmt.Printf("  Name:        %s\n", app.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", app.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", app.Metadata.Org)
	fmt.Println()

	if app.Spec != nil {
		fmt.Printf("Spec:\n")
		if app.Spec.Provider != "" {
			fmt.Printf("  Provider:          %s\n", app.Spec.Provider)
		}
		fmt.Printf("  Client ID:         %s\n", app.Spec.ClientId)
		fmt.Printf("  Client Secret:     [REDACTED]\n")
		if app.Spec.AuthorizationUrl != "" {
			fmt.Printf("  Authorization URL: %s\n", app.Spec.AuthorizationUrl)
		}
		if app.Spec.TokenUrl != "" {
			fmt.Printf("  Token URL:         %s\n", app.Spec.TokenUrl)
		}
		if len(app.Spec.Scopes) > 0 {
			fmt.Printf("  Scopes:            %s\n", strings.Join(app.Spec.Scopes, ", "))
		}
		fmt.Println()
	}
}
