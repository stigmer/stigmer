//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Invalid SDK project - contains intentional errors for testing error handling.
// This file has a syntax error that should cause SDK synthesis to fail.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Intentional error: calling undefined function
		undefinedFunction()

		log.Println("This should never execute")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}

// Note: undefinedFunction is intentionally not defined to cause a compilation error
