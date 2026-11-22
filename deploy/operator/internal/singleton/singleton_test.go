// Pins which Stigmer is reconciled when a cluster holds more than one: the
// oldest, then by namespace and name on a tie, and never one being deleted.

package singleton

import (
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

func at(ns, name string, minute int) stigmerv1.Stigmer {
	return stigmerv1.Stigmer{ObjectMeta: metav1.ObjectMeta{
		Namespace: ns, Name: name,
		CreationTimestamp: metav1.NewTime(time.Date(2026, 1, 1, 0, minute, 0, 0, time.UTC)),
	}}
}

func TestOldestWins(t *testing.T) {
	if got := Oldest([]stigmerv1.Stigmer{at("b", "x", 5), at("a", "y", 1)}); got.Namespace != "a" {
		t.Errorf("got %s/%s", got.Namespace, got.Name)
	}
	if got := Oldest([]stigmerv1.Stigmer{at("b", "x", 1), at("a", "y", 1)}); got.Namespace != "a" {
		t.Errorf("a tie is not broken by namespace: %s", got.Namespace)
	}
	deleting := at("a", "y", 1)
	now := metav1.Now()
	deleting.DeletionTimestamp = &now
	if got := Oldest([]stigmerv1.Stigmer{at("b", "x", 5), deleting}); got.Namespace != "b" {
		t.Errorf("a Stigmer being deleted won: %s", got.Namespace)
	}
	if Oldest(nil) != nil {
		t.Error("no Stigmer, yet one won")
	}
}
