// Every workload's requests and limits: a chosen default, an adopter's
// override merged over it, and a refusal before anything renders when the
// result cannot run.
//
// Defaults are the Helm chart's, which were sized for one team: memory is
// requested and limited, so a leak is a restart and not a node; CPU is
// requested and never limited, so a burst (a search-index rebuild at boot)
// is not throttled. An override replaces a default per resource name, so
// declaring only a memory limit keeps the default requests. A floor is the
// memory below which the workload cannot boot at all; a declared size under
// it, or a request above its own limit, is refused with the field's path,
// instead of a pod that is killed on start for a reason the adopter has to
// dig out of events.

package render

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// Sizing is one workload's default size and its floor.
type Sizing struct {
	// Path is the spec field an adopter overrides it with.
	Path string
	// Default is the size used when nothing is declared.
	Default corev1.ResourceRequirements
	// MemoryFloor is the least memory the workload boots with.
	MemoryFloor resource.Quantity
}

func size(cpuRequest, memRequest, memLimit, floor string) Sizing {
	return Sizing{
		Default: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse(cpuRequest),
				corev1.ResourceMemory: resource.MustParse(memRequest),
			},
			Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(memLimit)},
		},
		MemoryFloor: resource.MustParse(floor),
	}
}

// The sizes, by workload.
var (
	ServerSizing   = withPath(size("250m", "1Gi", "2Gi", "512Mi"), "spec.server.resources")
	RunnerSizing   = withPath(size("500m", "1Gi", "4Gi", "512Mi"), "spec.runner.resources")
	PostgresSizing = withPath(size("100m", "256Mi", "1Gi", "128Mi"), "spec.database.postgresql.bundled.resources")
	TemporalSizing = withPath(size("100m", "256Mi", "1Gi", "128Mi"), "spec.temporal.bundled.resources")
	// KeycloakSizing is the bundled sign-in's: its JVM is killed below about
	// 1 GiB under a realm import and a burst of sign-ins, so the limit leaves
	// room above the request. Not declarable: nothing an adopter tunes.
	KeycloakSizing = size("100m", "512Mi", "1536Mi", "512Mi")
)

func withPath(s Sizing, path string) Sizing {
	s.Path = path
	return s
}

// Effective merges a declared size over the default, per resource name.
func (s Sizing) Effective(declared *corev1.ResourceRequirements) corev1.ResourceRequirements {
	out := *s.Default.DeepCopy()
	if declared == nil {
		return out
	}
	for name, q := range declared.Requests {
		out.Requests[name] = q
	}
	for name, q := range declared.Limits {
		if out.Limits == nil {
			out.Limits = corev1.ResourceList{}
		}
		out.Limits[name] = q
	}
	return out
}

// Check refuses a size the workload cannot run with, in words naming the
// field, or returns "".
func (s Sizing) Check(declared *corev1.ResourceRequirements) string {
	eff := s.Effective(declared)
	for name, req := range eff.Requests {
		if limit, ok := eff.Limits[name]; ok && req.Cmp(limit) > 0 {
			return fmt.Sprintf("%s requests %s %s, more than its limit of %s: a pod can never be scheduled that way. Raise the limit or lower the request",
				s.Path, req.String(), name, limit.String())
		}
	}
	if mem, ok := eff.Limits[corev1.ResourceMemory]; ok && mem.Cmp(s.MemoryFloor) < 0 {
		return fmt.Sprintf("%s limits memory to %s, below the %s it needs to boot. Raise the limit to at least %s",
			s.Path, mem.String(), s.MemoryFloor.String(), s.MemoryFloor.String())
	}
	if mem, ok := eff.Requests[corev1.ResourceMemory]; ok && mem.Cmp(s.MemoryFloor) < 0 {
		return fmt.Sprintf("%s requests %s of memory, below the %s it needs to boot. Request at least %s",
			s.Path, mem.String(), s.MemoryFloor.String(), s.MemoryFloor.String())
	}
	return ""
}

// SizingRefusal checks every workload the Stigmer renders and returns the
// first refusal, or "".
func SizingRefusal(st *stigmerv1.Stigmer) string {
	checks := []struct {
		s        Sizing
		declared *corev1.ResourceRequirements
		on       bool
	}{
		{ServerSizing, st.Spec.Server.Resources, true},
		{RunnerSizing, st.Spec.Runner.Resources, true},
		{PostgresSizing, BundledDatabase(st).Resources, Database(st).Bundled},
		{TemporalSizing, bundledTemporalResources(st), Temporal(st).Bundled},
	}
	for _, c := range checks {
		if !c.on {
			continue
		}
		if msg := c.s.Check(c.declared); msg != "" {
			return msg
		}
	}
	return ""
}

func bundledTemporalResources(st *stigmerv1.Stigmer) *corev1.ResourceRequirements {
	if st.Spec.Temporal == nil || st.Spec.Temporal.Bundled == nil {
		return nil
	}
	return st.Spec.Temporal.Bundled.Resources
}

// BundledTemporalResources is the bundled Temporal's per-service size.
func BundledTemporalResources(st *stigmerv1.Stigmer) corev1.ResourceRequirements {
	return TemporalSizing.Effective(bundledTemporalResources(st))
}
