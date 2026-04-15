package agentinstance

import (
	"fmt"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays an agent instance in the specified format.
func DisplayGetResult(ai *agentinstancev1.AgentInstance, format string) {
	display.DisplayProto(ai, format, func() { displayTable(ai) })
}

func displayTable(ai *agentinstancev1.AgentInstance) {
	fmt.Println()
	fmt.Printf("AgentInstance: %s\n", ai.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", ai.Metadata.Id)
	fmt.Printf("  Name:        %s\n", ai.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", ai.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", ai.Metadata.Org)
	fmt.Println()

	if ai.Spec != nil {
		fmt.Printf("Spec:\n")
		fmt.Printf("  Agent ID:      %s\n", ai.Spec.AgentId)
		if ai.Spec.Description != "" {
			fmt.Printf("  Description:   %s\n", ai.Spec.Description)
		}
		if len(ai.Spec.EnvironmentRefs) > 0 {
			fmt.Printf("  Environments:  %d\n", len(ai.Spec.EnvironmentRefs))
		}
		fmt.Println()
	}
}
