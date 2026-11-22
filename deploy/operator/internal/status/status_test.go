// Pins how components fold into the Stigmer's status: a transition time that
// moves only on a phase, reason or object change; the install's phase as the
// worst component's; and the Ready condition speaking for the worst-off
// component with a count of the rest.

package status

import (
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

func TestTransitionTimeMovesOnlyOnChange(t *testing.T) {
	var s stigmerv1.StigmerStatus
	t0 := metav1.NewTime(time.Unix(100, 0))
	t1 := metav1.NewTime(time.Unix(200, 0))
	SetComponent(&s, stigmerv1.ComponentStatus{Name: "db", Phase: stigmerv1.PhaseDeploying, Reason: stigmerv1.ReasonDeploying, Message: "1 of 3"}, t0)
	changed, _ := SetComponent(&s, stigmerv1.ComponentStatus{Name: "db", Phase: stigmerv1.PhaseDeploying, Reason: stigmerv1.ReasonDeploying, Message: "2 of 3"}, t1)
	if changed || !s.Components[0].LastTransitionTime.Equal(&t0) || s.Components[0].Message != "2 of 3" {
		t.Errorf("a reworded message moved the transition: %+v", s.Components[0])
	}
	changed, prev := SetComponent(&s, stigmerv1.ComponentStatus{Name: "db", Phase: stigmerv1.PhaseReady, Reason: stigmerv1.ReasonHealthy}, t1)
	if !changed || prev.Phase != stigmerv1.PhaseDeploying || !s.Components[0].LastTransitionTime.Equal(&t1) {
		t.Errorf("a phase change did not move it: %+v", s.Components[0])
	}
}

func TestSummarizeSpeaksForTheWorst(t *testing.T) {
	st := &stigmerv1.Stigmer{Status: stigmerv1.StigmerStatus{Components: []stigmerv1.ComponentStatus{
		{Name: "keys", Phase: stigmerv1.PhaseReady, Reason: stigmerv1.ReasonHealthy},
		{Name: "database", Phase: stigmerv1.PhaseDeploying, Reason: stigmerv1.ReasonDeploying, Message: "starting"},
		{Name: "server", Phase: stigmerv1.PhaseDeploying, Reason: stigmerv1.ReasonImagePullFailed, Message: "cannot pull"},
		{Name: "runner", Phase: stigmerv1.PhasePending, Reason: stigmerv1.ReasonWaitingForDependency},
	}}}
	Summarize(st, "ready")
	c := meta.FindStatusCondition(st.Status.Conditions, stigmerv1.ConditionReady)
	if st.Status.Phase != stigmerv1.PhaseDeploying || c.Status != metav1.ConditionFalse || c.Message != "server: cannot pull (2 more not ready)" {
		t.Errorf("phase %s, condition %+v", st.Status.Phase, c)
	}
	st.Status.Components[1].Phase = stigmerv1.PhaseRefused
	Summarize(st, "ready")
	if st.Status.Phase != stigmerv1.PhaseRefused {
		t.Errorf("a refused component leaves the install %s", st.Status.Phase)
	}
	for i := range st.Status.Components {
		st.Status.Components[i].Phase = stigmerv1.PhaseReady
	}
	Summarize(st, "all good")
	c = meta.FindStatusCondition(st.Status.Conditions, stigmerv1.ConditionReady)
	if st.Status.Phase != stigmerv1.PhaseReady || c.Status != metav1.ConditionTrue || c.Message != "all good" {
		t.Errorf("phase %s, condition %+v", st.Status.Phase, c)
	}
}
