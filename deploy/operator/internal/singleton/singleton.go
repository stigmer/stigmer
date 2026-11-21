// One operator per cluster, one Stigmer per cluster.
//
// The cluster-level prerequisites the operator installs (CloudNativePG, and
// later the sandbox runtimes) are each one per cluster, so two operators
// would fight over them, and two Stigmers would share them with no one to
// say which version they run. OperatorConflict runs before the manager
// starts: a second operator Deployment elsewhere stops this process with a
// line naming it, and the check runs again on every restart, so this one
// starts once the other is gone. Oldest decides among Stigmers: the oldest
// one is reconciled, and every other is refused in words naming it, so
// deleting the wrong one is never a guess.

package singleton

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// OperatorLabel marks the operator's own Deployment, set by its chart.
const OperatorLabel = "app.kubernetes.io/name"

// OperatorLabelValue is OperatorLabel's value on the operator's Deployment.
const OperatorLabelValue = "stigmer-operator"

const serviceAccountNamespaceFile = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"

// OwnNamespace is the namespace this process runs in, or "" outside a cluster.
func OwnNamespace() string {
	b, err := os.ReadFile(serviceAccountNamespaceFile)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// OperatorConflict names another running operator, or returns "".
func OperatorConflict(ctx context.Context, c client.Reader, ownNamespace string) (string, error) {
	if ownNamespace == "" {
		return "", nil
	}
	var deployments appsv1.DeploymentList
	if err := c.List(ctx, &deployments, client.MatchingLabels{OperatorLabel: OperatorLabelValue}); err != nil {
		return "", fmt.Errorf("listing operator Deployments: %w", err)
	}
	var others []string
	for _, d := range deployments.Items {
		if d.Namespace == ownNamespace || (d.Spec.Replicas != nil && *d.Spec.Replicas == 0) {
			continue
		}
		others = append(others, d.Namespace+"/"+d.Name)
	}
	if len(others) == 0 {
		return "", nil
	}
	return fmt.Sprintf("another Stigmer operator runs in this cluster (%s); one operator per cluster: uninstall one", strings.Join(others, ", ")), nil
}

// Oldest is the Stigmer that is reconciled: the oldest, by name on a tie.
func Oldest(items []stigmerv1.Stigmer) *stigmerv1.Stigmer {
	var live []stigmerv1.Stigmer
	for _, s := range items {
		if s.DeletionTimestamp == nil {
			live = append(live, s)
		}
	}
	if len(live) == 0 {
		return nil
	}
	sort.Slice(live, func(i, j int) bool {
		a, b := live[i], live[j]
		if !a.CreationTimestamp.Equal(&b.CreationTimestamp) {
			return a.CreationTimestamp.Before(&b.CreationTimestamp)
		}
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		return a.Name < b.Name
	})
	return &live[0]
}
