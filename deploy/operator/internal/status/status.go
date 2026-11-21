// Folding the components' standings into the Stigmer's status: each
// component's entry, the install's phase, and the Ready condition whose
// message `kubectl get stigmer` prints.
//
// A component's lastTransitionTime moves only when its phase, reason or
// object changes, never for a reworded message, so a waiting sentence that
// counts something does not look like churn. The install's phase is the
// worst of its components': Refused, then Error, then Deploying, then
// Pending; Ready only when every one is. The Ready condition speaks for the
// worst-off component, naming it and how many others are not ready, so the
// one line a platform engineer reads points at the thing to fix first.

package status

import (
	"fmt"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// SetComponent records one component's standing and reports whether its
// phase or reason changed, with the entry it replaced (nil when new).
func SetComponent(st *stigmerv1.StigmerStatus, next stigmerv1.ComponentStatus, now metav1.Time) (bool, *stigmerv1.ComponentStatus) {
	for i := range st.Components {
		cur := &st.Components[i]
		if cur.Name != next.Name {
			continue
		}
		prev := *cur
		transition := cur.Phase != next.Phase || cur.Reason != next.Reason || !sameObject(cur.Object, next.Object)
		next.LastTransitionTime = cur.LastTransitionTime
		if transition {
			next.LastTransitionTime = now
		}
		*cur = next
		return cur.Phase != prev.Phase || cur.Reason != prev.Reason, &prev
	}
	next.LastTransitionTime = now
	st.Components = append(st.Components, next)
	return true, nil
}

func sameObject(a, b *stigmerv1.ObjectReference) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// Keep drops components not in names, in names' order.
func Keep(st *stigmerv1.StigmerStatus, names []string) {
	byName := map[string]stigmerv1.ComponentStatus{}
	for _, c := range st.Components {
		byName[c.Name] = c
	}
	out := make([]stigmerv1.ComponentStatus, 0, len(names))
	for _, n := range names {
		if c, ok := byName[n]; ok {
			out = append(out, c)
		}
	}
	st.Components = out
}

func severity(c stigmerv1.ComponentStatus) int {
	switch {
	case c.Phase == stigmerv1.PhaseRefused:
		return 5
	case c.Phase == stigmerv1.PhaseError:
		return 4
	case c.Reason.IsFailure():
		return 3
	case c.Phase == stigmerv1.PhaseDeploying:
		return 2
	case c.Phase == stigmerv1.PhasePending:
		return 1
	}
	return 0
}

// Summarize sets the install's phase and Ready condition from its
// components.
func Summarize(st *stigmerv1.Stigmer, readyMessage string) {
	s := &st.Status
	var worst *stigmerv1.ComponentStatus
	notReady := 0
	phases := map[stigmerv1.Phase]bool{}
	for i := range s.Components {
		c := &s.Components[i]
		phases[c.Phase] = true
		if c.Phase == stigmerv1.PhaseReady {
			continue
		}
		notReady++
		if worst == nil || severity(*c) > severity(*worst) {
			worst = c
		}
	}
	switch {
	case phases[stigmerv1.PhaseRefused]:
		s.Phase = stigmerv1.PhaseRefused
	case phases[stigmerv1.PhaseError]:
		s.Phase = stigmerv1.PhaseError
	case notReady == 0 && len(s.Components) > 0:
		s.Phase = stigmerv1.PhaseReady
	case phases[stigmerv1.PhaseDeploying]:
		s.Phase = stigmerv1.PhaseDeploying
	default:
		s.Phase = stigmerv1.PhasePending
	}

	cond := metav1.Condition{Type: stigmerv1.ConditionReady, ObservedGeneration: st.Generation}
	if worst == nil {
		cond.Status = metav1.ConditionTrue
		cond.Reason = string(stigmerv1.ReasonHealthy)
		cond.Message = readyMessage
	} else {
		cond.Status = metav1.ConditionFalse
		cond.Reason = string(worst.Reason)
		cond.Message = fmt.Sprintf("%s: %s", worst.Name, worst.Message)
		if notReady > 1 {
			cond.Message += fmt.Sprintf(" (%d more not ready)", notReady-1)
		}
	}
	meta.SetStatusCondition(&s.Conditions, cond)
}

// Refuse marks the whole install refused, with no component reconciled.
func Refuse(st *stigmerv1.Stigmer, reason stigmerv1.ComponentReason, message string) {
	st.Status.Phase = stigmerv1.PhaseRefused
	st.Status.Components = nil
	meta.SetStatusCondition(&st.Status.Conditions, metav1.Condition{
		Type:               stigmerv1.ConditionReady,
		Status:             metav1.ConditionFalse,
		Reason:             string(reason),
		Message:            message,
		ObservedGeneration: st.Generation,
	})
}
