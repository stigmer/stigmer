// Why a workload is not ready, in the words a platform engineer acts on.
//
// Explain reads a component's pods, their claims and their Events, and
// returns the most certain cause it finds, in order of certainty: a claim
// that cannot bind, a container that cannot be created (an image it cannot
// pull, a Secret it reads that is missing), a container killed for memory or
// exiting with an error (with the last lines it printed, so a server that
// refuses to boot says why in the Stigmer's status), a pod no node can take,
// a volume that cannot mount, and only then "running, not yet answering".
// Classify is the pure part, over objects already read, so every case is
// unit-tested without a cluster. Everything here reads through the uncached
// reader: it runs only while a component is not ready.

package component

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// Workload is what Classify explains.
type Workload struct {
	// Pods are the workload's pods.
	Pods []corev1.Pod
	// Claims are the claims those pods mount.
	Claims []corev1.PersistentVolumeClaim
	// Events are Events about the pods and claims.
	Events []corev1.Event
	// Containers limits the explanation to these container names; empty
	// means every container.
	Containers []string
}

func (w Workload) watches(container string) bool {
	if len(w.Containers) == 0 {
		return true
	}
	for _, c := range w.Containers {
		if c == container {
			return true
		}
	}
	return false
}

// Explain reads a workload's pods by selector and explains it, or returns
// fallback when nothing more specific is found.
func Explain(ctx context.Context, env *Env, selector map[string]string, containers []string, fallback Result) (Result, error) {
	ns := env.Stigmer.Namespace
	var pods corev1.PodList
	if err := env.Reader.List(ctx, &pods, client.InNamespace(ns), client.MatchingLabels(selector)); err != nil {
		return Result{}, fmt.Errorf("listing pods to explain %s: %w", fallback.Message, err)
	}
	w := Workload{Pods: pods.Items, Containers: containers}
	for _, pod := range pods.Items {
		for _, v := range pod.Spec.Volumes {
			if v.PersistentVolumeClaim == nil {
				continue
			}
			var claim corev1.PersistentVolumeClaim
			if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: ns, Name: v.PersistentVolumeClaim.ClaimName}, &claim); err == nil {
				w.Claims = append(w.Claims, claim)
			}
		}
	}
	var events corev1.EventList
	if err := env.Reader.List(ctx, &events, client.InNamespace(ns)); err == nil {
		names := map[string]bool{}
		for _, p := range w.Pods {
			names[p.Name] = true
		}
		for _, c := range w.Claims {
			names[c.Name] = true
		}
		for _, e := range events.Items {
			if names[e.InvolvedObject.Name] {
				w.Events = append(w.Events, e)
			}
		}
	}
	if r, ok := Classify(w, ns); ok {
		return r, nil
	}
	return fallback, nil
}

// Classify explains a workload, reporting false when nothing is wrong that
// it can see.
func Classify(w Workload, namespace string) (Result, bool) {
	for _, claim := range w.Claims {
		if claim.Status.Phase == corev1.ClaimBound {
			continue
		}
		ref := Ref("PersistentVolumeClaim", namespace, claim.Name)
		if e := latestEvent(w.Events, claim.Name, "ProvisioningFailed"); e != nil {
			return Deploying(stigmerv1.ReasonVolumeUnprovisionable, ref,
				fmt.Sprintf("claim %s cannot be provisioned: %s. Name a storage class that exists, or give the cluster a default", claim.Name, e.Message)), true
		}
		class := "the cluster's default storage class"
		if claim.Spec.StorageClassName != nil {
			class = "storage class " + *claim.Spec.StorageClassName
		}
		if latestEvent(w.Events, claim.Name, "FailedBinding") != nil && claim.Spec.StorageClassName == nil {
			return Deploying(stigmerv1.ReasonVolumeUnprovisionable, ref,
				fmt.Sprintf("claim %s cannot bind: the cluster has no default storage class. Name one in the declaration, or set a default", claim.Name)), true
		}
		return Deploying(stigmerv1.ReasonVolumeProvisioning, ref,
			fmt.Sprintf("waiting for %s to provision claim %s", class, claim.Name)), true
	}

	pods := append([]corev1.Pod(nil), w.Pods...)
	sort.Slice(pods, func(i, j int) bool {
		return pods[j].CreationTimestamp.Before(&pods[i].CreationTimestamp)
	})
	for _, pod := range pods {
		ref := Ref("Pod", namespace, pod.Name)
		statuses := append(append([]corev1.ContainerStatus(nil), pod.Status.InitContainerStatuses...), pod.Status.ContainerStatuses...)
		for _, cs := range statuses {
			if !w.watches(cs.Name) {
				continue
			}
			if r, ok := classifyContainer(cs, ref); ok {
				return r, true
			}
		}
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodScheduled && cond.Status == corev1.ConditionFalse && cond.Reason == corev1.PodReasonUnschedulable {
				return Deploying(stigmerv1.ReasonUnschedulable, ref,
					fmt.Sprintf("no node can take pod %s: %s. Add capacity, or lower the declared requests", pod.Name, cond.Message)), true
			}
		}
		if e := latestEvent(w.Events, pod.Name, "FailedMount"); e != nil && pod.Status.Phase == corev1.PodPending {
			return Deploying(stigmerv1.ReasonVolumeMountFailed, ref,
				fmt.Sprintf("pod %s cannot mount a volume: %s", pod.Name, e.Message)), true
		}
	}
	for _, pod := range pods {
		if pod.Status.Phase == corev1.PodRunning {
			return Deploying(stigmerv1.ReasonStartingUp, Ref("Pod", namespace, pod.Name),
				fmt.Sprintf("pod %s is running, not yet answering", pod.Name)), true
		}
	}
	return Result{}, false
}

func classifyContainer(cs corev1.ContainerStatus, ref *stigmerv1.ObjectReference) (Result, bool) {
	if waiting := cs.State.Waiting; waiting != nil {
		switch waiting.Reason {
		case "ErrImagePull", "ImagePullBackOff", "InvalidImageName":
			return Deploying(stigmerv1.ReasonImagePullFailed, ref,
				fmt.Sprintf("the node cannot pull %s for container %s: %s. Check the registry, the tag and the pull secrets", cs.Image, cs.Name, waiting.Message)), true
		case "CreateContainerConfigError", "CreateContainerError":
			return Deploying(stigmerv1.ReasonContainerConfigInvalid, ref,
				fmt.Sprintf("container %s cannot be created: %s", cs.Name, waiting.Message)), true
		}
	}
	terminated := cs.State.Terminated
	if terminated == nil {
		terminated = cs.LastTerminationState.Terminated
	}
	if terminated == nil {
		return Result{}, false
	}
	if terminated.Reason == "OOMKilled" {
		return Deploying(stigmerv1.ReasonOutOfMemory, ref,
			fmt.Sprintf("container %s was killed for exceeding its memory limit: raise the limit in the declaration", cs.Name)), true
	}
	crashing := cs.State.Waiting != nil && cs.State.Waiting.Reason == "CrashLoopBackOff"
	if terminated.ExitCode != 0 && (crashing || cs.RestartCount > 0 || cs.State.Terminated != nil) {
		msg := fmt.Sprintf("container %s keeps exiting (exit %d)", cs.Name, terminated.ExitCode)
		if line := telling(terminated.Message); line != "" {
			msg += ": " + line
		}
		return Deploying(stigmerv1.ReasonCrashLooping, ref, msg), true
	}
	return Result{}, false
}

// telling picks the line of a termination message that says why: a boot
// refusal or an error when there is one, otherwise the last line.
func telling(message string) string {
	var last string
	lines := strings.Split(strings.TrimSpace(message), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if last == "" {
			last = line
		}
		lower := strings.ToLower(line)
		if strings.Contains(lower, "boot failed") || strings.Contains(lower, "refus") || strings.Contains(lower, "fatal") {
			return clip(line)
		}
	}
	return clip(last)
}

func clip(s string) string {
	const max = 400
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

func latestEvent(events []corev1.Event, object, reason string) *corev1.Event {
	var found *corev1.Event
	for i := range events {
		e := &events[i]
		if e.InvolvedObject.Name != object || e.Reason != reason {
			continue
		}
		if found == nil || found.LastTimestamp.Before(&e.LastTimestamp) {
			found = e
		}
	}
	return found
}
