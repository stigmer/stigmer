package root

import (
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
)

// executeProjectApply handles the SDK track where stigmer.yaml has an entry_point set.
//
// The SDK track is being upgraded to the reference-based model where resources are
// applied individually and project membership is tracked via references (Phase 4).
// Until that adaptation is complete, this track returns an actionable error directing
// users to use declarative mode instead.
func executeProjectApply(detectResult *project.DetectResult, _ projectApplyOptions) error {
	return fmt.Errorf(
		"SDK track (entry_point: %s) is being upgraded to the reference model\n\n"+
			"This will be available in a future release.\n"+
			"For now, use declarative mode: remove entry_point from stigmer.yaml\n"+
			"and define resources as YAML files in the same directory",
		detectResult.Project.Spec.EntryPoint,
	)
}
