package workflowinstance

import (
	"fmt"

	workflowinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays a workflow instance in the specified format.
func DisplayGetResult(wi *workflowinstancev1.WorkflowInstance, format string) {
	display.DisplayProto(wi, format, func() { displayTable(wi) })
}

func displayTable(wi *workflowinstancev1.WorkflowInstance) {
	fmt.Println()
	fmt.Printf("WorkflowInstance: %s\n", wi.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", wi.Metadata.Id)
	fmt.Printf("  Name:        %s\n", wi.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", wi.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", wi.Metadata.Org)
	fmt.Println()

	if wi.Spec != nil {
		fmt.Printf("Spec:\n")
		fmt.Printf("  Workflow ID:   %s\n", wi.Spec.WorkflowId)
		if wi.Spec.Description != "" {
			fmt.Printf("  Description:   %s\n", wi.Spec.Description)
		}
		if len(wi.Spec.EnvironmentRefs) > 0 {
			fmt.Printf("  Environments:  %d\n", len(wi.Spec.EnvironmentRefs))
		}
		fmt.Println()
	}
}
