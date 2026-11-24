// Pins how someone else's controller is recognised: an image reference is
// compared by its name alone, whatever registry, mirror path, tag or digest
// it carries; and every prerequisite's carried release yields the controller
// image name the operator looks for, so moving a vendored release that
// renames its controller fails here rather than refusing working clusters.

package component

import (
	"testing"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate/install"
)

func TestAnImageIsComparedByItsNameAlone(t *testing.T) {
	for ref, want := range map[string]string{
		"ghcr.io/cloudnative-pg/cloudnative-pg:1.30.2":               "cloudnative-pg",
		"localhost:5000/cloudnative-pg:dev":                          "cloudnative-pg",
		"mirror.example.com/team/cloudnative-pg@sha256:0123abcd":     "cloudnative-pg",
		"cloudnative-pg:1.30.2":                                      "cloudnative-pg",
		"cloudnative-pg":                                             "cloudnative-pg",
		"ghcr.io/cloudnative-pg/plugin-barman-cloud-sidecar:v0.16.0": "plugin-barman-cloud-sidecar",
		"ko://go.ate.dev/substrate/cmd/atecontroller":                "atecontroller",
	} {
		if got := imageName(ref); got != want {
			t.Errorf("imageName(%q) = %q, want %q", ref, got, want)
		}
	}
}

func TestEveryPrerequisiteKnowsItsControllersImage(t *testing.T) {
	st := &stigmerv1.Stigmer{}
	for _, c := range []struct {
		p    Prerequisite
		want string
	}{
		{CloudNativePG(st), "cloudnative-pg"},
		{BarmanCloudPlugin(st), "plugin-barman-cloud"},
		{AgentSandboxPrerequisite(st), "agent-sandbox-controller"},
	} {
		image, err := c.p.controllerImage()
		if err != nil {
			t.Fatalf("%s: %v", c.p.Name, err)
		}
		if got := imageName(image); got != c.want {
			t.Errorf("%s's controller runs %q (%s), want %q", c.p.Name, got, image, c.want)
		}
	}
	image, err := install.ControllerImage()
	if err != nil {
		t.Fatal(err)
	}
	if got := imageName(image); got != "atecontroller" {
		t.Errorf("Agent Substrate's controller runs %q (%s), want atecontroller", got, image)
	}
}
