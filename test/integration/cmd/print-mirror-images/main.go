// Command print-mirror-images prints every Docker Hub image the integration
// harness can pull, one per line — the interface between the Go source of
// truth (harness.MirrorImages) and the GHCR mirror-sync workflow
// (.github/workflows/mirror-test-images.yaml), which copies each printed
// image to ghcr.io/stigmer/mirror/.
//
// Deriving the list by running the code, rather than maintaining a manifest
// beside it, makes drift between the harness and the mirror impossible: the
// list includes the Ryuk reaper image at whatever version the resolved
// testcontainers-go dependency ships.
package main

import (
	"fmt"

	"github.com/stigmer/stigmer/test/integration/harness"
)

func main() {
	for _, image := range harness.MirrorImages() {
		fmt.Println(image)
	}
}
