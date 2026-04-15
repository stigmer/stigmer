package environment

import (
	"fmt"

	environmentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays an environment in the specified format.
func DisplayGetResult(env *environmentv1.Environment, format string) {
	display.DisplayProto(env, format, func() { displayTable(env) })
}

func displayTable(env *environmentv1.Environment) {
	fmt.Println()
	fmt.Printf("Environment: %s\n", env.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", env.Metadata.Id)
	fmt.Printf("  Name:        %s\n", env.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", env.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", env.Metadata.Org)
	fmt.Println()

	if env.Spec != nil {
		if env.Spec.Description != "" {
			fmt.Printf("Description: %s\n", env.Spec.Description)
			fmt.Println()
		}

		if len(env.Spec.Data) > 0 {
			fmt.Printf("Variables:\n")
			for key, val := range env.Spec.Data {
				if val.IsSecret {
					fmt.Printf("  %s: [REDACTED] (secret)\n", key)
				} else {
					fmt.Printf("  %s: %s\n", key, val.Value)
				}
			}
			fmt.Println()
		}
	}
}
