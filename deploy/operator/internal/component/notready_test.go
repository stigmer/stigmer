// Pins the order and the words of the NotReady explanation on fixed pod,
// claim and Event states: a claim that cannot bind before anything about
// pods, a pull failure and a missing Secret named, a memory kill, a crash
// loop carrying the line that says why (a boot refusal over the last line,
// a database ahead of the server with its restore path among them),
// an unschedulable pod, and "running, not yet answering" last. A container
// filter keeps the runner's crash out of the server's explanation.

package component

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

func pod(name string, phase corev1.PodPhase, statuses ...corev1.ContainerStatus) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, CreationTimestamp: metav1.Now()},
		Status:     corev1.PodStatus{Phase: phase, ContainerStatuses: statuses},
	}
}

func waiting(name, reason, message string) corev1.ContainerStatus {
	return corev1.ContainerStatus{Name: name, Image: "ghcr.io/stigmer/stigmer-server:v9", State: corev1.ContainerState{
		Waiting: &corev1.ContainerStateWaiting{Reason: reason, Message: message},
	}}
}

func crashed(name string, exit int32, message string) corev1.ContainerStatus {
	return corev1.ContainerStatus{
		Name: name, RestartCount: 3,
		State:                corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}},
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: exit, Message: message, Reason: "Error"}},
	}
}

func TestClassify(t *testing.T) {
	pending := corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "data"}, Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimPending}}
	cases := []struct {
		name   string
		w      Workload
		reason stigmerv1.ComponentReason
		says   string
	}{
		{"a claim waits for its volume", Workload{Claims: []corev1.PersistentVolumeClaim{pending},
			Pods: []corev1.Pod{pod("p", corev1.PodPending, waiting("server", "ImagePullBackOff", "x"))}},
			stigmerv1.ReasonVolumeProvisioning, "waiting for the cluster's default storage class to provision claim data"},
		{"a claim no class can provision", Workload{Claims: []corev1.PersistentVolumeClaim{pending},
			Events: []corev1.Event{{InvolvedObject: corev1.ObjectReference{Name: "data"}, Reason: "ProvisioningFailed", Message: "storageclass \"fast\" not found"}}},
			stigmerv1.ReasonVolumeUnprovisionable, "storageclass \"fast\" not found"},
		{"an image the node cannot pull", Workload{Pods: []corev1.Pod{pod("p", corev1.PodPending, waiting("server", "ImagePullBackOff", "not found"))}},
			stigmerv1.ReasonImagePullFailed, "the node cannot pull ghcr.io/stigmer/stigmer-server:v9"},
		{"a Secret a container reads is missing", Workload{Pods: []corev1.Pod{pod("p", corev1.PodPending, waiting("server", "CreateContainerConfigError", "secret \"license\" not found"))}},
			stigmerv1.ReasonContainerConfigInvalid, "secret \"license\" not found"},
		{"a memory kill", Workload{Pods: []corev1.Pod{pod("p", corev1.PodRunning, corev1.ContainerStatus{Name: "server", RestartCount: 1,
			LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", ExitCode: 137}}})}},
			stigmerv1.ReasonOutOfMemory, "exceeding its memory limit"},
		{"a boot refusal is the line relayed", Workload{Pods: []corev1.Pod{pod("p", corev1.PodRunning,
			crashed("server", 1, "starting\nboot failed: The Stigmer Enterprise license key could not be verified\nbye"))}},
			stigmerv1.ReasonCrashLooping, "exit 1): boot failed: The Stigmer Enterprise license key could not be verified"},
		{"a database ahead of the server is relayed with its restore path", Workload{Pods: []corev1.Pod{pod("p", corev1.PodRunning,
			crashed("server", 1, "migrating\nboot failed: Database schema version 41 is newer than this server supports (maximum 40; schema \"public\"). Run a newer Stigmer release that supports this schema, or restore a backup from before the database upgrade.\nexit"))}},
			stigmerv1.ReasonCrashLooping, "restore a backup from before the database upgrade"},
		{"otherwise the last line", Workload{Pods: []corev1.Pod{pod("p", corev1.PodRunning, crashed("server", 2, "one\ntwo\n"))}},
			stigmerv1.ReasonCrashLooping, "(exit 2): two"},
		{"a pod no node can take", Workload{Pods: []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "p"}, Status: corev1.PodStatus{Phase: corev1.PodPending,
			Conditions: []corev1.PodCondition{{Type: corev1.PodScheduled, Status: corev1.ConditionFalse, Reason: corev1.PodReasonUnschedulable, Message: "0/1 nodes: insufficient memory"}}}}}},
			stigmerv1.ReasonUnschedulable, "insufficient memory"},
		{"running, not answering", Workload{Pods: []corev1.Pod{pod("p", corev1.PodRunning, corev1.ContainerStatus{Name: "server",
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}})}},
			stigmerv1.ReasonStartingUp, "running, not yet answering"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := Classify(c.w, "ns")
			if !ok {
				t.Fatal("nothing classified")
			}
			if got.Reason != c.reason || !strings.Contains(got.Message, c.says) {
				t.Errorf("got %s %q; want %s saying %q", got.Reason, got.Message, c.reason, c.says)
			}
		})
	}
}

func TestClassifyWatchesOnlyItsContainers(t *testing.T) {
	w := Workload{
		Pods:       []corev1.Pod{pod("p", corev1.PodRunning, crashed("runner", 1, "runner died"), corev1.ContainerStatus{Name: "server", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}})},
		Containers: []string{"server"},
	}
	got, _ := Classify(w, "ns")
	if got.Reason == stigmerv1.ReasonCrashLooping {
		t.Errorf("the runner's crash explains the server: %q", got.Message)
	}
}

func TestClassifyFindsNothingWithoutPods(t *testing.T) {
	if _, ok := Classify(Workload{}, "ns"); ok {
		t.Error("an empty workload was classified")
	}
}
