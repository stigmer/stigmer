// The bundled sign-in: Keycloak as a plain workload on the bundled
// database's `keycloak` database, served at <hostname>/idp.
//
// The split horizon. Keycloak's hostname is the public URL, so every
// document it serves names the public issuer, the one browsers, the CLI and
// the desktop app sign in at. With its back channel dynamic, an address it is
// asked for on its in-cluster Service (the signing keys, user info, tokens)
// comes back on that Service, so the server fetches the discovery document
// in-cluster (STIGMER_OIDC_DISCOVERY_URL) and never needs the public name to
// resolve from inside the cluster.
//
// The admin credential is the operator's alone: a bootstrap admin minted
// into <name>-keycloak-admin, which the operator signs in with to converge
// the realm (internal/keycloak). The owner's one-time password lives in
// <name>-owner-setup until the owner has replaced it.

package render

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/intstr"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

const (
	// ComponentIdentity is the bundled sign-in's component name.
	ComponentIdentity = "identity"
	// KeycloakImage is the bundled sign-in's image.
	KeycloakImage = "quay.io/keycloak/keycloak:26.8.2"
	// KeycloakPort is Keycloak's HTTP port; KeycloakManagementPort serves its
	// health.
	KeycloakPort = 8080
	// KeycloakManagementPort serves Keycloak's health endpoints.
	KeycloakManagementPort = 9000
	// KeycloakUser and KeycloakDatabase are the bundled database's role and
	// database for the sign-in.
	KeycloakUser = "keycloak"
	// KeycloakDatabase is the sign-in's database.
	KeycloakDatabase = "keycloak"
	// Realm is the realm Stigmer's people sign in to.
	Realm = "stigmer"
	// RealmPath is the realm's path under the sign-in's base URL.
	RealmPath = "/realms/" + Realm
	// ConsoleClientID and NativeClientID are the realm's two clients: the
	// web console's, and the desktop app's and the CLI's.
	ConsoleClientID = "stigmer-console"
	// NativeClientID is the desktop app's and the CLI's client.
	NativeClientID = "stigmer-native"
	// OperatorClientID is the master realm's client the operator converges
	// the realm with.
	OperatorClientID = "stigmer-operator"
	// OwnerSetupPasswordKey is the owner setup Secret's key.
	OwnerSetupPasswordKey = "password"
	// OperatorClientSecretKey is the admin Secret's key for the operator's
	// client secret.
	OperatorClientSecretKey = "client-secret"
)

// KeycloakDeployment and KeycloakService are the sign-in's workload and
// address.
func KeycloakDeployment(st *stigmerv1.Stigmer) string { return st.Name + "-keycloak" }

// KeycloakService is the sign-in's in-cluster address.
func KeycloakService(st *stigmerv1.Stigmer) string { return st.Name + "-keycloak" }

// KeycloakAdminSecret is the operator's own credential on the sign-in.
func KeycloakAdminSecret(st *stigmerv1.Stigmer) string { return st.Name + "-keycloak-admin" }

// OwnerSetupSecret holds the owner's one-time password until it is used.
func OwnerSetupSecret(st *stigmerv1.Stigmer) string { return st.Name + "-owner-setup" }

// PostgresKeycloakSecret is the operator-minted password of the keycloak role.
func PostgresKeycloakSecret(st *stigmerv1.Stigmer) string { return PostgresCluster(st) + "-keycloak" }

// KeycloakPublicURL is the sign-in's base URL on the front door.
func KeycloakPublicURL(st *stigmerv1.Stigmer) string { return PublicURL(st) + IdentityPath }

// KeycloakInternalURL is the sign-in's base URL on its Service.
func KeycloakInternalURL(st *stigmerv1.Stigmer) string {
	return fmt.Sprintf("http://%s.%s.svc:%d%s", KeycloakService(st), st.Namespace, KeycloakPort, IdentityPath)
}

// BundledIssuer is the realm's issuer, as every token and document names it.
func BundledIssuer(st *stigmerv1.Stigmer) string { return KeycloakPublicURL(st) + RealmPath }

// KeycloakRole is the keycloak role, declared to CloudNativePG beside
// Temporal's.
func KeycloakRole(st *stigmerv1.Stigmer) map[string]any {
	return map[string]any{
		"name":           KeycloakUser,
		"ensure":         "present",
		"login":          true,
		"passwordSecret": map[string]any{"name": PostgresKeycloakSecret(st)},
	}
}

// KeycloakDatabaseObject is the sign-in's database, owned by its role and
// kept if the Database object is ever removed.
func KeycloakDatabaseObject(st *stigmerv1.Stigmer) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": CNPGAPIVersion,
		"kind":       "Database",
		"metadata": map[string]any{
			"name":      PostgresCluster(st) + "-keycloak",
			"namespace": st.Namespace,
			"labels":    labelsAny(st, ComponentDatabase),
		},
		"spec": map[string]any{
			"name":                  KeycloakDatabase,
			"owner":                 KeycloakUser,
			"cluster":               map[string]any{"name": PostgresCluster(st)},
			"ensure":                "present",
			"databaseReclaimPolicy": "retain",
		},
	}}
}

// KeycloakServiceObject is the sign-in's in-cluster address.
func KeycloakServiceObject(st *stigmerv1.Stigmer) *corev1.Service {
	return &corev1.Service{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "Service"},
		ObjectMeta: meta(st, KeycloakService(st), ComponentIdentity),
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: SelectorLabels(st, ComponentIdentity),
			Ports: []corev1.ServicePort{
				{Name: "http", Port: KeycloakPort, TargetPort: intstr.FromString("http"), AppProtocol: ptr("http")},
			},
		},
	}
}

func healthProbe(path string, initialDelay, period, failures int32) *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{
			Path: path,
			Port: intstr.FromString("management"),
		}},
		InitialDelaySeconds: initialDelay,
		PeriodSeconds:       period,
		FailureThreshold:    failures,
	}
}

// KeycloakDeploymentObject is the sign-in's workload.
func KeycloakDeploymentObject(st *stigmerv1.Stigmer) *appsv1.Deployment {
	pull := st.Spec.Image.PullPolicy
	if pull == "" {
		pull = corev1.PullIfNotPresent
	}
	admin := KeycloakAdminSecret(st)
	env := []corev1.EnvVar{
		value("KC_DB", "postgres"),
		value("KC_DB_URL", fmt.Sprintf("jdbc:postgresql://%s:5432/%s", PostgresReadWriteService(st), KeycloakDatabase)),
		value("KC_DB_USERNAME", KeycloakUser),
		fromSecret("KC_DB_PASSWORD", PostgresKeycloakSecret(st), corev1.BasicAuthPasswordKey, false),
		value("KC_HOSTNAME", KeycloakPublicURL(st)),
		value("KC_HOSTNAME_BACKCHANNEL_DYNAMIC", "true"),
		value("KC_HTTP_RELATIVE_PATH", IdentityPath),
		value("KC_HTTP_ENABLED", "true"),
		value("KC_PROXY_HEADERS", "xforwarded"),
		value("KC_HEALTH_ENABLED", "true"),
		// Health stays at the management port's root, whatever the public
		// path, so the probes name one path.
		value("KC_HTTP_MANAGEMENT_RELATIVE_PATH", "/"),
		fromSecret("KC_BOOTSTRAP_ADMIN_USERNAME", admin, corev1.BasicAuthUsernameKey, false),
		fromSecret("KC_BOOTSTRAP_ADMIN_PASSWORD", admin, corev1.BasicAuthPasswordKey, false),
		// The JVM's heap follows the container's limit, not the node's
		// memory.
		value("JAVA_OPTS_KC_HEAP", "-XX:MaxRAMPercentage=70"),
	}
	return &appsv1.Deployment{
		TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
		ObjectMeta: meta(st, KeycloakDeployment(st), ComponentIdentity),
		Spec: appsv1.DeploymentSpec{
			Replicas: ptr(int32(1)),
			Selector: &metav1.LabelSelector{MatchLabels: SelectorLabels(st, ComponentIdentity)},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: Labels(st, ComponentIdentity)},
				Spec: corev1.PodSpec{
					AutomountServiceAccountToken: ptr(false),
					ImagePullSecrets:             st.Spec.Image.PullSecrets,
					SecurityContext: &corev1.PodSecurityContext{
						SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
					},
					Containers: []corev1.Container{{
						Name:            "keycloak",
						Image:           KeycloakImage,
						ImagePullPolicy: pull,
						Args:            []string{"start"},
						Env:             env,
						Ports: []corev1.ContainerPort{
							{Name: "http", ContainerPort: KeycloakPort},
							{Name: "management", ContainerPort: KeycloakManagementPort},
						},
						StartupProbe:             healthProbe("/health/started", 10, 5, 60),
						ReadinessProbe:           healthProbe("/health/ready", 0, 10, 3),
						LivenessProbe:            healthProbe("/health/live", 0, 30, 3),
						Resources:                KeycloakSizing.Effective(nil),
						TerminationMessagePolicy: corev1.TerminationMessageFallbackToLogsOnError,
						SecurityContext: &corev1.SecurityContext{
							RunAsNonRoot:             ptr(true),
							AllowPrivilegeEscalation: ptr(false),
							Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
						},
					}},
				},
			},
		},
	}
}
