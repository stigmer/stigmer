package organization

import (
	"fmt"
	"os"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
)

// DisplayGetResult displays an organization in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(org *organizationv1.Organization, format string) {
	display.DisplayProto(org, format, func() { displayGetTable(org) })
}

func displayGetTable(org *organizationv1.Organization) {
	fmt.Println()
	fmt.Printf("Organization: %s\n", org.GetMetadata().GetName())
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:   %s\n", org.GetMetadata().GetId())
	fmt.Printf("  Name: %s\n", org.GetMetadata().GetName())
	fmt.Printf("  Slug: %s\n", org.GetMetadata().GetSlug())
	fmt.Println()

	if org.GetSpec() != nil {
		fmt.Printf("Spec:\n")
		if org.GetSpec().GetDescription() != "" {
			fmt.Printf("  Description: %s\n", org.GetSpec().GetDescription())
		}
		if org.GetSpec().GetLogoUrl() != "" {
			fmt.Printf("  Logo URL:    %s\n", org.GetSpec().GetLogoUrl())
		}
		fmt.Println()
	}
}

// DisplayListResult displays a list of organizations in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayListResult(orgs []*organizationv1.Organization, format string) {
	if len(orgs) == 0 {
		display.DisplayEmptyResults("organizations", "")
		return
	}

	display.DisplayProtoSlice(orgs, format, func() { displayListTable(orgs) })
}

func displayListTable(orgs []*organizationv1.Organization) {
	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()
	dimColor := color.New(color.Faint).SprintFunc()

	tbl := display.NewTable(
		[]string{"NAME", "SLUG", "DESCRIPTION", "ID"},
		display.WithHeaderColor(headerColor),
		display.WithAdaptive(),
	)

	for _, org := range orgs {
		desc := ""
		if org.GetSpec() != nil {
			desc = display.TruncateDescription(org.GetSpec().GetDescription(), 40)
			desc = display.NormalizeWhitespace(desc)
		}

		tbl.AddRow(
			org.GetMetadata().GetName(),
			org.GetMetadata().GetSlug(),
			desc,
			dimColor(org.GetMetadata().GetId()),
		)
	}

	fmt.Println()
	tbl.Render(os.Stdout)
}
