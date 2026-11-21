// Pins the order the bundled Temporal comes up in against a real API
// server: nothing of Temporal's services before its schema Job has
// completed, then the frontend alone, and the history, matching and worker
// services only once the frontend is available, so the services never race
// to write the cluster's metadata row on a fresh database. envtest runs no
// controllers, so the Job's completion and the frontend's availability are
// written by the test.

package controller

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func TestTemporalsFrontendComesUpAlone(t *testing.T) {
	ctx := context.Background()
	ns := namespace(t)
	s := stigmer(ns, "stigmer")
	s.UID = "u"
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}
	deployment := func(service string) (*appsv1.Deployment, bool) {
		var d appsv1.Deployment
		err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.TemporalFullname(s) + "-" + service}, &d)
		if apierrors.IsNotFound(err) {
			return nil, false
		}
		if err != nil {
			t.Fatal(err)
		}
		return &d, true
	}

	// The schema first: no service while its Job runs.
	res, err := component.Temporal{}.Reconcile(ctx, env)
	if err != nil || res.Reason != stigmerv1.ReasonWaitingForSchema {
		t.Fatalf("before the schema: %+v %v", res, err)
	}
	if _, ok := deployment("frontend"); ok {
		t.Fatal("a Temporal service was applied before its schema")
	}
	var jobs batchv1.JobList
	if err := k8s.List(ctx, &jobs, client.InNamespace(ns)); err != nil {
		t.Fatal(err)
	}
	for i := range jobs.Items {
		job := &jobs.Items[i]
		if !strings.HasPrefix(job.Name, render.TemporalSchemaJobPrefix(s)) {
			continue
		}
		now := metav1.Now()
		job.Status.StartTime = &now
		job.Status.CompletionTime = &now
		job.Status.Succeeded = 1
		job.Status.Conditions = []batchv1.JobCondition{
			{Type: batchv1.JobSuccessCriteriaMet, Status: corev1.ConditionTrue},
			{Type: batchv1.JobComplete, Status: corev1.ConditionTrue},
		}
		if err := k8s.Status().Update(ctx, job); err != nil {
			t.Fatal(err)
		}
	}

	// The frontend alone.
	res, err = component.Temporal{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseDeploying || !strings.Contains(res.Message, "frontend") {
		t.Fatalf("with the schema in: %+v %v", res, err)
	}
	frontend, ok := deployment("frontend")
	if !ok {
		t.Fatal("the frontend was not applied once the schema was in")
	}
	for _, service := range []string{"history", "matching", "worker"} {
		if _, ok := deployment(service); ok {
			t.Fatalf("Temporal's %s was applied before the frontend was available", service)
		}
	}

	// The rest, once the frontend is available.
	frontend.Status.Replicas = 1
	frontend.Status.UpdatedReplicas = 1
	frontend.Status.ReadyReplicas = 1
	frontend.Status.AvailableReplicas = 1
	frontend.Status.ObservedGeneration = frontend.Generation
	if err := k8s.Status().Update(ctx, frontend); err != nil {
		t.Fatal(err)
	}
	res, err = component.Temporal{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseDeploying {
		t.Fatalf("with the frontend available: %+v %v", res, err)
	}
	for _, service := range []string{"history", "matching", "worker"} {
		if _, ok := deployment(service); !ok {
			t.Errorf("Temporal's %s was not applied once the frontend was available", service)
		}
	}
}
