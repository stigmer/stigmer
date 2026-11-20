// The server's workload: one Deployment holding the server and, when it
// runs, the shared runner; its Service; and the claims they mount. With a
// bucket declared, files live in the bucket and the artifacts claim is not
// rendered, so no claim holds anything a backup needs.
//
// One replica, recreated rather than rolled: the server keeps per-process
// state (its keyed serializer, a sandbox driver's queues) besides its claims,
// so two copies must never overlap. The containers keep the Helm chart's
// security posture: the server runs as the image's non-root user; the runner
// runs as root because its start script drops each agent to its own user,
// keeping only the five capabilities that takes. Every container reports its
// last log lines as its termination message, so a server that refuses to
// boot (a license it cannot verify, a database newer than itself) says why
// in the Stigmer's status, not only in its logs.

package render

import (
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// Component names, used in labels and status.
const (
	ComponentKeys        = "keys"
	ComponentObjectStore = "objectStore"
	ComponentDatabase    = "database"
	ComponentTemporal    = "temporal"
	ComponentServer      = "server"
	ComponentRunner      = "runner"
)

// Container names in the server's pod.
const (
	ServerContainer = "server"
	RunnerContainer = "runner"
)

// ClaimSize is a claim's default capacity, by claim.
var (
	ServerDataSize = resource.MustParse("5Gi")
	RunnerDataSize = resource.MustParse("10Gi")
	ArtifactsSize  = resource.MustParse("20Gi")
	PostgresSize   = resource.MustParse("10Gi")
)

func ptr[T any](v T) *T { return &v }

func meta(st *stigmerv1.Stigmer, name, component string) metav1.ObjectMeta {
	return metav1.ObjectMeta{Name: name, Namespace: st.Namespace, Labels: Labels(st, component)}
}

// Claim renders one ReadWriteOnce claim.
func Claim(st *stigmerv1.Stigmer, name string, declared *stigmerv1.VolumeSpec, def resource.Quantity) *corev1.PersistentVolumeClaim {
	capacity := def
	var class *string
	if declared != nil {
		if declared.Size != nil {
			capacity = *declared.Size
		}
		class = declared.StorageClassName
	}
	return &corev1.PersistentVolumeClaim{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "PersistentVolumeClaim"},
		ObjectMeta: meta(st, name, ComponentServer),
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			StorageClassName: class,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: capacity},
			},
		},
	}
}

// ServerClaims are the claims the server's pod mounts.
func ServerClaims(st *stigmerv1.Stigmer) []*corev1.PersistentVolumeClaim {
	claims := []*corev1.PersistentVolumeClaim{
		Claim(st, ServerDataClaim(st), st.Spec.Server.Storage, ServerDataSize),
	}
	if ObjectStore(st) == nil {
		claims = append(claims, Claim(st, ArtifactsClaim(st), st.Spec.Server.Artifacts, ArtifactsSize))
	}
	if RunnerEnabled(st) {
		claims = append(claims, Claim(st, RunnerDataClaim(st), st.Spec.Runner.Storage, RunnerDataSize))
	}
	return claims
}

// ServerServiceObject is the server's in-cluster address. Its API port says
// kubernetes.io/h2c, the standard word (Gateway API's backend protocol, read
// by Gateway implementations and several Ingress controllers) for a backend
// that speaks HTTP/2 without TLS: gRPC needs it, and the server's port
// answers the console and Connect over it too. A front door that wants its
// own hint on the Service gets it from spec.ingress.serviceAnnotations.
func ServerServiceObject(st *stigmerv1.Stigmer) *corev1.Service {
	m := meta(st, ServerService(st), ComponentServer)
	if fd := FrontDoor(st); fd != nil && len(fd.ServiceAnnotations) > 0 {
		m.Annotations = fd.ServiceAnnotations
	}
	return &corev1.Service{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "Service"},
		ObjectMeta: m,
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: SelectorLabels(st, ComponentServer),
			Ports: []corev1.ServicePort{
				{Name: "grpc-api", Port: GRPCPort, TargetPort: intstr.FromString("grpc-api"), AppProtocol: ptr("kubernetes.io/h2c")},
				{Name: "artifacts", Port: ArtifactsPort, TargetPort: intstr.FromString("artifacts"), AppProtocol: ptr("http")},
			},
		},
	}
}

func grpcProbe(initialDelay, period, failures int32) *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler:        corev1.ProbeHandler{GRPC: &corev1.GRPCAction{Port: GRPCPort}},
		InitialDelaySeconds: initialDelay,
		PeriodSeconds:       period,
		FailureThreshold:    failures,
	}
}

func volume(name, claim string) corev1.Volume {
	return corev1.Volume{Name: name, VolumeSource: corev1.VolumeSource{
		PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: claim},
	}}
}

// ServerDeploymentObject is the server's (and the shared runner's) workload.
func ServerDeploymentObject(st *stigmerv1.Stigmer) *appsv1.Deployment {
	pull := st.Spec.Image.PullPolicy
	if pull == "" {
		pull = corev1.PullIfNotPresent
	}
	server := corev1.Container{
		Name:            ServerContainer,
		Image:           ServerImage(st),
		ImagePullPolicy: pull,
		Env:             append(ServerEnv(st), st.Spec.Server.ExtraEnv...),
		Ports: []corev1.ContainerPort{
			{Name: "grpc-api", ContainerPort: GRPCPort},
			{Name: "artifacts", ContainerPort: ArtifactsPort},
		},
		StartupProbe:             grpcProbe(0, 5, 30),
		ReadinessProbe:           grpcProbe(10, 10, 3),
		LivenessProbe:            grpcProbe(30, 30, 3),
		Resources:                ServerSizing.Effective(st.Spec.Server.Resources),
		TerminationMessagePolicy: corev1.TerminationMessageFallbackToLogsOnError,
		SecurityContext: &corev1.SecurityContext{
			RunAsNonRoot:             ptr(true),
			RunAsUser:                ptr(int64(1000)),
			RunAsGroup:               ptr(int64(1000)),
			AllowPrivilegeEscalation: ptr(false),
			Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			SeccompProfile:           &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
		},
		VolumeMounts: []corev1.VolumeMount{{Name: "server-data", MountPath: "/data"}},
	}
	volumes := []corev1.Volume{volume("server-data", ServerDataClaim(st))}
	onVolume := ObjectStore(st) == nil
	if onVolume {
		server.VolumeMounts = append(server.VolumeMounts, corev1.VolumeMount{Name: "artifacts", MountPath: ArtifactsMount})
		volumes = append(volumes, volume("artifacts", ArtifactsClaim(st)))
	}
	containers := []corev1.Container{server}
	if RunnerEnabled(st) {
		runnerMounts := []corev1.VolumeMount{{Name: "runner-data", MountPath: "/data"}}
		if onVolume {
			runnerMounts = append(runnerMounts, corev1.VolumeMount{Name: "artifacts", MountPath: ArtifactsMount})
		}
		containers = append(containers, corev1.Container{
			Name:                     RunnerContainer,
			Image:                    RunnerImage(st),
			ImagePullPolicy:          pull,
			Env:                      append(RunnerEnv(st), st.Spec.Runner.ExtraEnv...),
			Resources:                RunnerSizing.Effective(st.Spec.Runner.Resources),
			TerminationMessagePolicy: corev1.TerminationMessageFallbackToLogsOnError,
			SecurityContext: &corev1.SecurityContext{
				AllowPrivilegeEscalation: ptr(false),
				Capabilities: &corev1.Capabilities{
					Drop: []corev1.Capability{"ALL"},
					Add:  []corev1.Capability{"SETUID", "SETGID", "CHOWN", "KILL", "DAC_OVERRIDE"},
				},
				SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
			},
			VolumeMounts: runnerMounts,
		})
		volumes = append(volumes, volume("runner-data", RunnerDataClaim(st)))
	}
	return &appsv1.Deployment{
		TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
		ObjectMeta: meta(st, ServerDeployment(st), ComponentServer),
		Spec: appsv1.DeploymentSpec{
			Replicas: ptr(int32(1)),
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Selector: &metav1.LabelSelector{MatchLabels: SelectorLabels(st, ComponentServer)},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: Labels(st, ComponentServer)},
				Spec: corev1.PodSpec{
					AutomountServiceAccountToken:  ptr(false),
					TerminationGracePeriodSeconds: ptr(int64(60)),
					ImagePullSecrets:              st.Spec.Image.PullSecrets,
					SecurityContext: &corev1.PodSecurityContext{
						FSGroup:        ptr(int64(1000)),
						SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
					},
					Containers: containers,
					Volumes:    volumes,
				},
			},
		},
	}
}
