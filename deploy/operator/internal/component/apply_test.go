// Pins the ownership contract every apply goes through: the Stigmer's
// reference is added once, merged by UID; another operator's controller
// reference is kept and ours becomes a plain owner reference; the managed-by
// label is stamped; and the two shapes Kubernetes cannot collect (a
// cluster-scoped object, an object in another namespace) are refused.

package component

import (
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func object(kind, namespace, name string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetKind(kind)
	u.SetNamespace(namespace)
	u.SetName(name)
	return u
}

func namespacedUnless(cluster string) func(*unstructured.Unstructured) (bool, error) {
	return func(u *unstructured.Unstructured) (bool, error) { return u.GetKind() != cluster, nil }
}

func TestOwnStampsOnce(t *testing.T) {
	st := &stigmerv1.Stigmer{ObjectMeta: metav1.ObjectMeta{Name: "s", Namespace: "ns", UID: types.UID("u1")}}
	u := object("Deployment", "ns", "d")
	for range 2 {
		if err := Own(st, []*unstructured.Unstructured{u}, namespacedUnless("")); err != nil {
			t.Fatal(err)
		}
	}
	refs := u.GetOwnerReferences()
	if len(refs) != 1 || refs[0].UID != "u1" || refs[0].Controller == nil || !*refs[0].Controller {
		t.Errorf("owner references %+v", refs)
	}
	if u.GetLabels()[render.ManagedByLabel] != render.ManagedByValue {
		t.Error("not labelled as the operator's")
	}
}

func TestOwnKeepsAnotherController(t *testing.T) {
	st := &stigmerv1.Stigmer{ObjectMeta: metav1.ObjectMeta{Name: "s", Namespace: "ns", UID: types.UID("u1")}}
	u := object("Secret", "ns", "x")
	yes := true
	u.SetOwnerReferences([]metav1.OwnerReference{{UID: "other", Controller: &yes, Kind: "Cluster", Name: "pg", APIVersion: "postgresql.cnpg.io/v1"}})
	if err := Own(st, []*unstructured.Unstructured{u}, namespacedUnless("")); err != nil {
		t.Fatal(err)
	}
	refs := u.GetOwnerReferences()
	if len(refs) != 2 || refs[0].UID != "other" || refs[1].Controller != nil {
		t.Errorf("owner references %+v", refs)
	}
}

func TestOwnRefusesWhatCannotBeCollected(t *testing.T) {
	st := &stigmerv1.Stigmer{ObjectMeta: metav1.ObjectMeta{Name: "s", Namespace: "ns", UID: "u1"}}
	err := Own(st, []*unstructured.Unstructured{object("ClusterRole", "", "r")}, namespacedUnless("ClusterRole"))
	if err == nil || !strings.Contains(err.Error(), "cluster-scoped") {
		t.Errorf("a cluster-scoped object: %v", err)
	}
	err = Own(st, []*unstructured.Unstructured{object("Service", "elsewhere", "s")}, namespacedUnless(""))
	if err == nil || !strings.Contains(err.Error(), "outside the Stigmer's namespace") {
		t.Errorf("an object in another namespace: %v", err)
	}
}
