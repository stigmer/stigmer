// The Stigmer resource: what a platform engineer declares, and the status the
// operator writes back in words.
//
// The spec carries only what the operator renders today. A field arrives
// with the code that acts on it, so `kubectl explain stigmer.spec` never
// lists a setting that does nothing. Cross-field rules are CEL rules on the
// definition, so the API server refuses a contradictory declaration at
// apply time with a sentence, before the operator sees it. Rules that need
// the cluster (a Secret that is missing, a second Stigmer) are the
// operator's, and they reach the status instead.
//
// Status is one list of components, each with a phase, a one-word reason,
// the object it is about and a sentence; the Ready condition carries the
// worst-off component's sentence, which is what `kubectl get stigmer` prints.

package v1

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StigmerSpec declares one Stigmer install.
//
// +kubebuilder:validation:XValidation:rule="!(has(self.database) && has(self.database.postgresql) && has(self.database.postgresql.external)) || (has(self.temporal) && has(self.temporal.external))",message="spec.database.postgresql.external names your own Postgres, and the operator does not create Temporal's databases on a Postgres it does not run: bring your own Temporal too (spec.temporal.external), or let the operator run the database"
// +kubebuilder:validation:XValidation:rule="!has(self.enterprise) || (has(self.identity) && has(self.identity.oidc))",message="Stigmer Enterprise signs every caller in, and a licensed server refuses to boot without sign-in: set spec.identity.oidc"
// +kubebuilder:validation:XValidation:rule="!has(self.enterprise) || !has(self.temporal) || !has(self.temporal.external) || has(self.temporal.external.tls) || has(self.temporal.external.apiKey)",message="under a Stigmer Enterprise license, spec.temporal.external must authenticate: whoever reaches a plaintext Temporal can start work on the runner's queue, and a licensed install serves many organizations. Set spec.temporal.external.tls or spec.temporal.external.apiKey"
// +kubebuilder:validation:XValidation:rule="has(self.objectStore) || !has(self.database) || !has(self.database.postgresql) || !has(self.database.postgresql.bundled) || (!has(self.database.postgresql.bundled.backup) && !has(self.database.postgresql.bundled.recoverFrom))",message="the database's backups and restores live in the bucket: declare spec.objectStore to use spec.database.postgresql.bundled.backup or recoverFrom"
// +kubebuilder:validation:XValidation:rule="!has(self.objectStore) || !has(self.server) || !has(self.server.artifacts)",message="spec.server.artifacts sizes the artifacts volume, and an install with spec.objectStore keeps its artifacts in the bucket instead: remove spec.server.artifacts"
// +kubebuilder:validation:XValidation:rule="!has(self.identity) || !has(self.identity.bundled) || has(self.ingress)",message="the bundled sign-in serves people's browsers at the front door: declare spec.ingress with the hostname they reach Stigmer at"
// +kubebuilder:validation:XValidation:rule="!(has(self.identity) ? has(self.identity.bundled) : (has(self.ingress) && !(has(self.server) && has(self.server.allowUnauthenticatedExposure) && self.server.allowUnauthenticatedExposure))) || has(self.owner)",message="the bundled sign-in creates the owner's account first, so an exposed install needs spec.owner.email; or name your own issuer in spec.identity.oidc"
// +kubebuilder:validation:XValidation:rule="!(has(self.identity) ? has(self.identity.bundled) : has(self.ingress)) || !has(self.database) || !has(self.database.postgresql) || !has(self.database.postgresql.external)",message="the bundled sign-in keeps its accounts on the bundled database, and spec.database.postgresql.external names your own: sign people in with your own issuer (spec.identity.oidc), or let the operator run the database"
// +kubebuilder:validation:XValidation:rule="!(has(self.server) && has(self.server.allowUnauthenticatedExposure) && self.server.allowUnauthenticatedExposure) || !has(self.identity)",message="spec.server.allowUnauthenticatedExposure exposes the install with sign-in off, and spec.identity turns sign-in on: keep one"
// +kubebuilder:validation:XValidation:rule="!has(self.sandboxes) || !has(self.sandboxes.driver) || self.sandboxes.driver == 'shared' || has(self.objectStore)",message="a sandbox on any node reads and writes a run's files through the bucket, never through a shared disk: declare spec.objectStore to run agents in per-session sandboxes"
type StigmerSpec struct {
	// Image says where Stigmer's images are pulled from. The tag is always
	// this operator's own version: operator vX runs Stigmer vX.
	// +optional
	Image ImageSpec `json:"image,omitempty"`

	// Owner is the person who runs this install. They own the organization
	// when sign-in is on, and every action is attributed to them when it
	// is off (the server's STIGMER_OPERATOR_EMAIL and STIGMER_OPERATOR_NAME).
	// +optional
	Owner *OwnerSpec `json:"owner,omitempty"`

	// Server sizes and tunes the Stigmer server.
	// +optional
	Server ServerSpec `json:"server,omitempty"`

	// Runner sizes and tunes the shared runner, the worker that runs agents
	// beside the server.
	// +optional
	Runner RunnerSpec `json:"runner,omitempty"`

	// Database is where Stigmer keeps its records. Absent, the operator runs
	// Postgres for you.
	// +optional
	Database *DatabaseSpec `json:"database,omitempty"`

	// Temporal is the workflow engine Stigmer's runs execute on. Absent, the
	// operator runs it for you on the bundled database.
	// +optional
	Temporal *TemporalSpec `json:"temporal,omitempty"`

	// ObjectStore is the bucket Stigmer keeps its files in: what a run stores
	// beside its record, Skills, and the database's archive. Declared, the
	// server and the runner share no disk, a runner reads and writes files
	// through short-lived URLs without ever holding the bucket's keys, and
	// the bundled database archives to the bucket from its first minute.
	// Absent, files live on a volume the server and the shared runner share.
	// +optional
	ObjectStore *ObjectStoreSpec `json:"objectStore,omitempty"`

	// Ingress is the front door: the one hostname people reach Stigmer at,
	// for the console, the API, sign-in (/idp) and files kept on a volume
	// (/artifacts). Absent, the install is reached by port-forward.
	// +optional
	Ingress *IngressSpec `json:"ingress,omitempty"`

	// Identity is how people sign in. Absent on an install with a front
	// door, the operator runs the bundled sign-in; absent on one without,
	// the server signs nobody in and every caller is the owner, which is
	// safe only while the install is reachable from inside the cluster.
	// +optional
	Identity *IdentitySpec `json:"identity,omitempty"`

	// Enterprise runs Stigmer Enterprise under a license.
	// +optional
	Enterprise *EnterpriseSpec `json:"enterprise,omitempty"`

	// Sandboxes is where engineers' agents run: beside the server on the
	// shared runner, or each session in a sandbox of its own.
	// +optional
	Sandboxes *SandboxesSpec `json:"sandboxes,omitempty"`

	// Prerequisites says which cluster-level operators this operator may
	// install when they are missing.
	// +optional
	Prerequisites PrerequisitesSpec `json:"prerequisites,omitempty"`
}

// ImageSpec says where images come from, for a mirror or a private registry.
type ImageSpec struct {
	// Registry holds every Stigmer image under its usual name.
	// +kubebuilder:default="ghcr.io/stigmer"
	// +optional
	Registry string `json:"registry,omitempty"`

	// PullPolicy applies to every Stigmer image.
	// +kubebuilder:validation:Enum=Always;IfNotPresent;Never
	// +kubebuilder:default=IfNotPresent
	// +optional
	PullPolicy corev1.PullPolicy `json:"pullPolicy,omitempty"`

	// PullSecrets are Secrets in this namespace the kubelet pulls with.
	// +optional
	PullSecrets []corev1.LocalObjectReference `json:"pullSecrets,omitempty"`
}

// OwnerSpec names the person who runs the install.
type OwnerSpec struct {
	// Email is the owner's sign-in address.
	// +kubebuilder:validation:XValidation:rule="self.contains('@')",message="spec.owner.email must be an email address"
	Email string `json:"email"`

	// Name is how the owner is shown.
	// +optional
	Name string `json:"name,omitempty"`
}

// ServerSpec tunes the Stigmer server.
type ServerSpec struct {
	// Resources overrides the server container's requests and limits.
	// +optional
	Resources *corev1.ResourceRequirements `json:"resources,omitempty"`

	// Storage is the server's own volume: the skill store and everything
	// under its home except artifacts. Defaults to 5Gi.
	// +optional
	Storage *VolumeSpec `json:"storage,omitempty"`

	// Artifacts is the volume the server writes artifacts to and the shared
	// runner reads them from, when no objectStore is declared. Defaults to
	// 20Gi.
	// +optional
	Artifacts *VolumeSpec `json:"artifacts,omitempty"`

	// Help is where your people ask for help, shown in the console.
	// +optional
	Help *HelpSpec `json:"help,omitempty"`

	// InternalAccounts are your own team's sign-in addresses, each exact
	// (sam@example.com) or with one * (*@example.com), left out of the
	// onboarding count.
	// +optional
	InternalAccounts []string `json:"internalAccounts,omitempty"`

	// AllowUnauthenticatedExposure says, on purpose, that an install with a
	// front door signs nobody in: everyone who reaches the hostname acts as
	// the owner. Without it, a front door brings the bundled sign-in.
	// +optional
	AllowUnauthenticatedExposure bool `json:"allowUnauthenticatedExposure,omitempty"`

	// Egress fences the server's own outbound calls. Off by default: a
	// server reaches an issuer or an MCP server on your private network,
	// which a fence would cut. An Enterprise license whose outboundEgress is
	// strict fences it too.
	// +optional
	Egress *ServerEgressSpec `json:"egress,omitempty"`

	// ExtraEnv adds settings to the server container. A name the operator
	// sets itself is refused, so nothing here can silently undo the
	// declaration above.
	// +optional
	ExtraEnv []corev1.EnvVar `json:"extraEnv,omitempty"`
}

// ServerEgressSpec fences the server's outbound calls.
type ServerEgressSpec struct {
	// Fenced lets the server reach only DNS, the Kubernetes API, what the
	// install runs (its database, Temporal, the bundled sign-in), the
	// bucket, the public internet and AllowCIDRs.
	// +optional
	Fenced bool `json:"fenced,omitempty"`

	// AllowCIDRs are private ranges the fenced server may also reach, such
	// as an external database, Temporal, issuer or MCP server.
	// +kubebuilder:validation:XValidation:rule="self.all(c, isCIDR(c))",message="spec.server.egress.allowCIDRs holds CIDR ranges, such as 10.20.0.0/16"
	// +kubebuilder:validation:MaxItems=64
	// +kubebuilder:validation:items:MaxLength=43
	// +optional
	AllowCIDRs []string `json:"allowCIDRs,omitempty"`
}

// IngressSpec is the front door: an Ingress the cluster's controller serves,
// or routes on a Gateway the cluster runs.
//
// +kubebuilder:validation:XValidation:rule="has(self.tls) != has(self.gatewayRef)",message="spec.ingress needs exactly one of tls (an Ingress with its certificate) or gatewayRef (routes on your Gateway, whose listener holds the certificate)"
type IngressSpec struct {
	// Hostname is the one name people reach Stigmer at, on port 443 (the CLI
	// and the desktop app speak TLS to a server on 443).
	// +kubebuilder:validation:Pattern=`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$`
	Hostname string `json:"hostname"`

	// ClassName is the IngressClass that serves the front door.
	// +optional
	ClassName string `json:"className,omitempty"`

	// Annotations go on the Ingress for the console, the API and files, for
	// a controller that needs a hint to speak gRPC to the server.
	// +optional
	Annotations map[string]string `json:"annotations,omitempty"`

	// ServiceAnnotations go on the server's Service, for a controller that
	// reads its gRPC hint there (Traefik's
	// traefik.ingress.kubernetes.io/service.serversscheme: h2c).
	// +optional
	ServiceAnnotations map[string]string `json:"serviceAnnotations,omitempty"`

	// TLS is the front door's certificate.
	// +optional
	TLS *IngressTLSSpec `json:"tls,omitempty"`

	// GatewayRef attaches routes to a Gateway the cluster runs instead of
	// rendering an Ingress. The operator never edits the Gateway.
	// +optional
	GatewayRef *GatewayReference `json:"gatewayRef,omitempty"`
}

// IngressTLSSpec names the front door's certificate.
//
// +kubebuilder:validation:XValidation:rule="has(self.secretName) != has(self.issuer)",message="spec.ingress.tls needs exactly one of secretName (a certificate you keep) or issuer (cert-manager issues one)"
type IngressTLSSpec struct {
	// SecretName is a TLS Secret in this namespace you keep current.
	// +optional
	SecretName string `json:"secretName,omitempty"`

	// Issuer is the cert-manager issuer that issues the certificate.
	// +optional
	Issuer *IssuerReference `json:"issuer,omitempty"`
}

// IssuerReference names a cert-manager issuer.
type IssuerReference struct {
	// Name is the issuer's name.
	Name string `json:"name"`

	// Kind is Issuer (in this namespace) or ClusterIssuer.
	// +kubebuilder:validation:Enum=Issuer;ClusterIssuer
	// +kubebuilder:default=ClusterIssuer
	// +optional
	Kind string `json:"kind,omitempty"`
}

// GatewayReference names a Gateway API Gateway and, optionally, its listener.
type GatewayReference struct {
	// Name is the Gateway's name.
	Name string `json:"name"`

	// Namespace is the Gateway's namespace; this one when empty.
	// +optional
	Namespace string `json:"namespace,omitempty"`

	// SectionName is the listener the routes attach to.
	// +optional
	SectionName string `json:"sectionName,omitempty"`
}

// HelpSpec is the console's help link.
type HelpSpec struct {
	// URL is where the link goes.
	URL string `json:"url"`

	// Label is the link's text.
	// +optional
	Label string `json:"label,omitempty"`
}

// RunnerSpec tunes the shared runner.
type RunnerSpec struct {
	// LLM names the Secret holding the model provider's key, read by key name:
	// ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, OPENAI_API_KEY,
	// ANTHROPIC_FOUNDRY_API_KEY or AWS_BEARER_TOKEN_BEDROCK. Agents cannot run
	// without one.
	// +optional
	LLM *LLMSpec `json:"llm,omitempty"`

	// Resources overrides the runner container's requests and limits.
	// +optional
	Resources *corev1.ResourceRequirements `json:"resources,omitempty"`

	// Storage is the runner's own volume: paused sessions, their approvals
	// and agent workspaces. Defaults to 10Gi.
	// +optional
	Storage *VolumeSpec `json:"storage,omitempty"`

	// ExtraEnv adds settings to the runner container. A name the operator
	// sets itself is refused.
	// +optional
	ExtraEnv []corev1.EnvVar `json:"extraEnv,omitempty"`
}

// LLMSpec names the model key's Secret.
type LLMSpec struct {
	// SecretName is a Secret in this namespace.
	// +kubebuilder:validation:MinLength=1
	SecretName string `json:"secretName"`
}

// VolumeSpec sizes one claim.
type VolumeSpec struct {
	// Size is the claim's requested capacity.
	// +optional
	Size *resource.Quantity `json:"size,omitempty"`

	// StorageClassName is the class the claim binds with; absent means the
	// cluster's default.
	// +optional
	StorageClassName *string `json:"storageClassName,omitempty"`
}

// ObjectStoreSpec is the bucket Stigmer keeps its files in.
type ObjectStoreSpec struct {
	// S3 is any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO, or Google
	// Cloud Storage through its S3 API.
	S3 S3Spec `json:"s3"`
}

// S3Spec names one S3-compatible bucket.
type S3Spec struct {
	// Bucket is the bucket's name.
	// +kubebuilder:validation:MinLength=3
	// +kubebuilder:validation:MaxLength=63
	Bucket string `json:"bucket"`

	// Region is the bucket's region; R2 also accepts us-east-1.
	// +kubebuilder:default=us-east-1
	// +optional
	Region string `json:"region,omitempty"`

	// Endpoint is the store's URL, such as
	// https://<account>.r2.cloudflarestorage.com or
	// http://minio.storage.svc:9000. Absent means AWS S3 itself.
	// +kubebuilder:validation:XValidation:rule="self.startsWith('https://') || self.startsWith('http://')",message="spec.objectStore.s3.endpoint must be an http or https URL"
	// +optional
	Endpoint string `json:"endpoint,omitempty"`

	// CredentialsSecret is a Secret in this namespace holding the bucket's
	// access key as ACCESS_KEY_ID and SECRET_ACCESS_KEY. The server and the
	// database's backups read it; no runner ever does.
	CredentialsSecret corev1.LocalObjectReference `json:"credentialsSecret"`

	// RunnerEndpoint is the address runners reach the store at, when it is
	// not Endpoint: the URLs handed to runners are signed for it, since a
	// signed URL's host is part of its signature.
	// +kubebuilder:validation:XValidation:rule="self.startsWith('https://') || self.startsWith('http://')",message="spec.objectStore.s3.runnerEndpoint must be an http or https URL"
	// +optional
	RunnerEndpoint string `json:"runnerEndpoint,omitempty"`
}

// DatabaseSpec is where Stigmer keeps its records.
type DatabaseSpec struct {
	// PostgreSQL is the one database engine Stigmer runs on in a cluster.
	// +optional
	PostgreSQL *PostgreSQLSpec `json:"postgresql,omitempty"`
}

// PostgreSQLSpec chooses the bundled Postgres or yours.
//
// +kubebuilder:validation:XValidation:rule="!(has(self.bundled) && has(self.external))",message="spec.database.postgresql: choose one of bundled or external"
type PostgreSQLSpec struct {
	// Bundled is the Postgres the operator runs, through CloudNativePG.
	// +optional
	Bundled *BundledPostgreSQLSpec `json:"bundled,omitempty"`

	// External is a Postgres you run.
	// +optional
	External *ExternalPostgreSQLSpec `json:"external,omitempty"`
}

// BundledPostgreSQLSpec sizes the bundled Postgres.
type BundledPostgreSQLSpec struct {
	// Instances is the number of Postgres instances: one primary, the rest
	// standbys.
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=5
	// +kubebuilder:default=1
	// +optional
	Instances int32 `json:"instances,omitempty"`

	// Storage sizes each instance's volume. Defaults to 10Gi.
	// +optional
	Storage *VolumeSpec `json:"storage,omitempty"`

	// Resources overrides each instance's requests and limits.
	// +optional
	Resources *corev1.ResourceRequirements `json:"resources,omitempty"`

	// Backup tunes the database's backups. With spec.objectStore declared the
	// database archives every change to the bucket from its first minute and
	// takes a full backup on this schedule; these are the defaults otherwise.
	// +optional
	Backup *PostgreSQLBackupSpec `json:"backup,omitempty"`

	// RecoverFrom creates the database from an archive in the bucket instead
	// of empty: the install it names, to the moment it names. Honoured only
	// when the database is created; on a running install it changes nothing,
	// and the status says so.
	// +optional
	RecoverFrom *RecoverFromSpec `json:"recoverFrom,omitempty"`
}

// PostgreSQLBackupSpec tunes the bundled database's backups.
type PostgreSQLBackupSpec struct {
	// Schedule is when a full backup is taken, as a six-field cron with
	// seconds first, in UTC. Defaults to daily at 02:00.
	// +kubebuilder:default="0 0 2 * * *"
	// +optional
	Schedule string `json:"schedule,omitempty"`

	// Retention is how long backups and the archive are kept, as a number and
	// d, w or m. Defaults to 30d.
	// +kubebuilder:validation:Pattern=`^[1-9][0-9]*[dwm]$`
	// +kubebuilder:default="30d"
	// +optional
	Retention string `json:"retention,omitempty"`
}

// RecoverFromSpec names an archive to restore the database from.
type RecoverFromSpec struct {
	// ServerName is the archive's name in the bucket: the source install's
	// status.backup.serverName.
	// +kubebuilder:validation:MinLength=1
	ServerName string `json:"serverName"`

	// TargetTime is the moment to restore to, in RFC 3339. Absent restores
	// to the newest moment the archive holds.
	// +kubebuilder:validation:Format=date-time
	// +optional
	TargetTime string `json:"targetTime,omitempty"`
}

// ExternalPostgreSQLSpec names a Postgres you run.
type ExternalPostgreSQLSpec struct {
	// Host is the server's address.
	// +kubebuilder:validation:MinLength=1
	Host string `json:"host"`

	// Port is the server's port.
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=65535
	// +kubebuilder:default=5432
	// +optional
	Port int32 `json:"port,omitempty"`

	// User is the role Stigmer signs in as. It needs to own Database, where
	// Stigmer creates its schemas.
	// +kubebuilder:validation:MinLength=1
	User string `json:"user"`

	// Database is the database Stigmer uses.
	// +kubebuilder:default=stigmer
	// +optional
	Database string `json:"database,omitempty"`

	// PasswordSecret names the Secret and key holding the role's password.
	PasswordSecret SecretKeySelector `json:"passwordSecret"`

	// SSLMode is libpq's sslmode for the connection.
	// +kubebuilder:validation:Enum=disable;allow;prefer;require;verify-ca;verify-full
	// +optional
	SSLMode string `json:"sslMode,omitempty"`
}

// SecretKeySelector names one key of a Secret in the Stigmer's namespace.
type SecretKeySelector struct {
	// Name is the Secret's name.
	// +kubebuilder:validation:MinLength=1
	Name string `json:"name"`

	// Key is the key within the Secret.
	// +kubebuilder:validation:MinLength=1
	Key string `json:"key"`
}

// TemporalSpec chooses the bundled Temporal or yours.
//
// +kubebuilder:validation:XValidation:rule="!(has(self.bundled) && has(self.external))",message="spec.temporal: choose one of bundled or external"
type TemporalSpec struct {
	// Bundled is the Temporal the operator runs on the bundled database.
	// +optional
	Bundled *BundledTemporalSpec `json:"bundled,omitempty"`

	// External is a Temporal frontend you run.
	// +optional
	External *ExternalTemporalSpec `json:"external,omitempty"`
}

// BundledTemporalSpec sizes the bundled Temporal.
type BundledTemporalSpec struct {
	// Resources overrides each Temporal service's requests and limits
	// (frontend, history, matching, worker).
	// +optional
	Resources *corev1.ResourceRequirements `json:"resources,omitempty"`
}

// ExternalTemporalSpec names a Temporal frontend you run.
type ExternalTemporalSpec struct {
	// HostPort is the frontend's gRPC address, such as temporal.internal:7233,
	// with an IPv6 address in brackets.
	// +kubebuilder:validation:Pattern=`^(\[[0-9A-Fa-f:.]+\]|[^:\[\]]+):[0-9]+$`
	HostPort string `json:"hostPort"`

	// Namespace is the Temporal namespace Stigmer's runs use.
	// +kubebuilder:default=default
	// +optional
	Namespace string `json:"namespace,omitempty"`

	// TLS turns on TLS to the frontend. With no keys named, the frontend's
	// certificate is checked against the system's trusted roots.
	// +optional
	TLS *TemporalTLSSpec `json:"tls,omitempty"`

	// APIKey names the Secret and key holding the frontend's API key
	// (Temporal Cloud, or a frontend with a JWT authorizer). An API key
	// implies TLS.
	// +optional
	APIKey *SecretKeySelector `json:"apiKey,omitempty"`
}

// TemporalTLSSpec is TLS to an external Temporal, every item a PEM in one
// Secret, read by key.
//
// +kubebuilder:validation:XValidation:rule="has(self.certKey) == has(self.keyKey)",message="spec.temporal.external.tls: certKey and keyKey go together; mutual TLS needs the client certificate and its key"
// +kubebuilder:validation:XValidation:rule="!(has(self.caKey) || has(self.certKey) || has(self.keyKey)) || has(self.secretName)",message="spec.temporal.external.tls names keys but not their Secret: set secretName"
type TemporalTLSSpec struct {
	// SecretName is the Secret holding the PEM items below.
	// +optional
	SecretName string `json:"secretName,omitempty"`

	// ServerName overrides the name the frontend's certificate is checked
	// against.
	// +optional
	ServerName string `json:"serverName,omitempty"`

	// CAKey is the key of the CA that signed the frontend's certificate.
	// +optional
	CAKey string `json:"caKey,omitempty"`

	// CertKey is the key of the client certificate, for mutual TLS.
	// +optional
	CertKey string `json:"certKey,omitempty"`

	// KeyKey is the key of the client certificate's private key.
	// +optional
	KeyKey string `json:"keyKey,omitempty"`
}

// IdentitySpec is how people sign in.
//
// +kubebuilder:validation:XValidation:rule="has(self.bundled) != has(self.oidc)",message="spec.identity needs exactly one of bundled (the sign-in the operator runs) or oidc (your own issuer)"
type IdentitySpec struct {
	// Bundled is the sign-in the operator runs beside Stigmer, at
	// <hostname>/idp. The owner's account is created with a one-time
	// password.
	// +optional
	Bundled *BundledIdentitySpec `json:"bundled,omitempty"`

	// OIDC is your own identity provider.
	// +optional
	OIDC *OIDCSpec `json:"oidc,omitempty"`
}

// BundledIdentitySpec tunes the bundled sign-in.
//
// +kubebuilder:validation:XValidation:rule="!has(self.signUp) || size(self.signUp.emailDomains) == 0 || has(self.smtp)",message="sign-up for your email domains needs mail: without a verification email anyone could claim an address in the domain. Set spec.identity.bundled.smtp"
type BundledIdentitySpec struct {
	// SignUp opens sign-up to people with an address in your domains, once
	// the owner has signed in. Absent, only the owner signs in.
	// +optional
	SignUp *SignUpSpec `json:"signUp,omitempty"`

	// SMTP is the mail server the sign-in sends verification and password
	// mail through.
	// +optional
	SMTP *SMTPSpec `json:"smtp,omitempty"`
}

// SignUpSpec limits who may sign up.
type SignUpSpec struct {
	// EmailDomains are the domains whose addresses may sign up, such as
	// acme.dev.
	// +kubebuilder:validation:items:Pattern=`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$`
	// +optional
	EmailDomains []string `json:"emailDomains,omitempty"`
}

// SMTPSpec is a mail server.
type SMTPSpec struct {
	// Host is the mail server's address.
	Host string `json:"host"`

	// Port is the mail server's port.
	// +kubebuilder:default=587
	// +optional
	Port int32 `json:"port,omitempty"`

	// From is the address mail is sent from.
	// +kubebuilder:validation:XValidation:rule="self.contains('@')",message="spec.identity.bundled.smtp.from must be an email address"
	From string `json:"from"`

	// SecretName is a Secret with the keys username and password, when the
	// mail server asks for them.
	// +optional
	SecretName string `json:"secretName,omitempty"`

	// StartTLS upgrades the connection to TLS.
	// +optional
	StartTLS bool `json:"starttls,omitempty"`
}

// OIDCSpec names an OpenID Connect issuer and the clients Stigmer is
// registered as.
type OIDCSpec struct {
	// Issuer is the issuer's URL, exactly as its discovery document names it.
	// +kubebuilder:validation:XValidation:rule="self.startsWith('https://') || self.matches('^http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?(/.*)?$')",message="spec.identity.oidc.issuer must be an https URL (plain http is allowed only for a loopback issuer)"
	Issuer string `json:"issuer"`

	// Audience is the audience the issuer puts in Stigmer's tokens.
	// +kubebuilder:validation:MinLength=1
	Audience string `json:"audience"`

	// ConsoleClientID is the web console's client.
	// +optional
	ConsoleClientID string `json:"consoleClientId,omitempty"`

	// NativeClientID is the desktop app's and the CLI's client.
	// +optional
	NativeClientID string `json:"nativeClientId,omitempty"`

	// DiscoveryURL is where the server fetches the issuer's discovery
	// document when it cannot reach the issuer's public name from inside the
	// cluster. The document must still name Issuer.
	// +optional
	DiscoveryURL string `json:"discoveryUrl,omitempty"`
}

// EnterpriseSpec runs Stigmer Enterprise.
//
// +kubebuilder:validation:XValidation:rule="has(self.license)",message="Stigmer Enterprise settings need a license: set spec.enterprise.license to the Secret holding your license key"
type EnterpriseSpec struct {
	// License names the Secret and key holding the license key you were sent.
	// The server runs the Enterprise image and verifies it at boot.
	// +optional
	License *SecretKeySelector `json:"license,omitempty"`

	// OrganizationCreators are the account ids (ida_ and 26 characters, as
	// `stigmer auth whoami` prints them) who may create an organization.
	// Empty means anyone signed in.
	// +optional
	OrganizationCreators []string `json:"organizationCreators,omitempty"`

	// AccessHistoryRetentionDays is how long the access history is kept;
	// absent keeps every entry.
	// +kubebuilder:validation:Minimum=1
	// +optional
	AccessHistoryRetentionDays *int32 `json:"accessHistoryRetentionDays,omitempty"`

	// OutboundEgress is which addresses the server dials when it reaches a
	// URL a person wrote: strict allows public addresses only; relaxed also
	// allows private and loopback ones, for an identity provider or MCP
	// server on your private network.
	// +kubebuilder:validation:Enum=strict;relaxed
	// +kubebuilder:default=strict
	// +optional
	OutboundEgress string `json:"outboundEgress,omitempty"`
}

// SandboxDriver is where an agent's session runs.
//
// +kubebuilder:validation:Enum=shared;agentSandbox
type SandboxDriver string

const (
	// SandboxDriverShared runs every session on the shared runner beside the
	// server: one pod, one disk, every agent's commands side by side.
	SandboxDriverShared SandboxDriver = "shared"
	// SandboxDriverAgentSandbox runs each session in a pod of its own through
	// agent-sandbox (agents.x-k8s.io), with its files on its own volumes.
	SandboxDriverAgentSandbox SandboxDriver = "agentSandbox"
)

// SandboxesSpec says where engineers' agents run.
//
// +kubebuilder:validation:XValidation:rule="!has(self.agentSandbox) || (has(self.driver) && self.driver == 'agentSandbox')",message="spec.sandboxes.agentSandbox tunes the agentSandbox driver: set spec.sandboxes.driver to agentSandbox, or remove it"
type SandboxesSpec struct {
	// Driver is where each session runs: shared (the shared runner beside
	// the server) or agentSandbox (a pod per session). A per-session driver
	// needs spec.objectStore, and the operator installs what it runs on.
	// +kubebuilder:default=shared
	// +optional
	Driver SandboxDriver `json:"driver,omitempty"`

	// IdleSeconds is how long a quiet sandbox stays awake before it sleeps;
	// it wakes with its files on the session's next message. Absent keeps
	// the driver's own default.
	// +kubebuilder:validation:Minimum=30
	// +optional
	IdleSeconds *int32 `json:"idleSeconds,omitempty"`

	// AgentSandbox tunes the agentSandbox driver.
	// +optional
	AgentSandbox *AgentSandboxSpec `json:"agentSandbox,omitempty"`
}

// AgentSandboxSpec tunes sessions that run in agent-sandbox pods.
type AgentSandboxSpec struct {
	// Egress widens the fence around the sandboxes. They always reach the
	// server, the bucket, DNS and the public internet, and never another
	// private address unless it is named here.
	// +optional
	Egress *SandboxEgressSpec `json:"egress,omitempty"`
}

// SandboxEgressSpec names the private ranges sandboxes may also reach.
type SandboxEgressSpec struct {
	// AllowCIDRs are private ranges a sandbox may reach besides the server
	// and the bucket, such as a model gateway or an MCP server on your
	// network (10.20.0.0/16, 192.168.4.7/32).
	// +kubebuilder:validation:XValidation:rule="self.all(c, isCIDR(c))",message="spec.sandboxes.agentSandbox.egress.allowCIDRs holds CIDR ranges, such as 10.20.0.0/16"
	// +kubebuilder:validation:MaxItems=64
	// +kubebuilder:validation:items:MaxLength=43
	// +optional
	AllowCIDRs []string `json:"allowCIDRs,omitempty"`
}

// PrerequisiteMode says whether the operator may install a cluster-level
// prerequisite.
//
// +kubebuilder:validation:Enum=auto;skip
type PrerequisiteMode string

const (
	// PrerequisiteAuto installs the prerequisite when it is missing and leaves
	// one someone else installed alone.
	PrerequisiteAuto PrerequisiteMode = "auto"
	// PrerequisiteSkip trusts that it is installed and never touches it.
	PrerequisiteSkip PrerequisiteMode = "skip"
)

// PrerequisitesSpec lists the cluster-level operators this one may install.
type PrerequisitesSpec struct {
	// PostgresOperator is CloudNativePG, which runs the bundled Postgres.
	// +kubebuilder:default=auto
	// +optional
	PostgresOperator PrerequisiteMode `json:"postgresOperator,omitempty"`

	// PostgresBackupPlugin is CloudNativePG's Barman Cloud plugin, which backs
	// the bundled Postgres up to the bucket. It needs cert-manager, which the
	// operator never installs.
	// +kubebuilder:default=auto
	// +optional
	PostgresBackupPlugin PrerequisiteMode `json:"postgresBackupPlugin,omitempty"`

	// AgentSandbox is agent-sandbox's controller, which runs the agentSandbox
	// driver's pods.
	// +kubebuilder:default=auto
	// +optional
	AgentSandbox PrerequisiteMode `json:"agentSandbox,omitempty"`
}

// Phase is where the install, or one component of it, stands.
//
// +kubebuilder:validation:Enum=Pending;Deploying;Ready;Refused;Error
type Phase string

const (
	// PhasePending waits for something else to be ready first.
	PhasePending Phase = "Pending"
	// PhaseDeploying is converging and says on what.
	PhaseDeploying Phase = "Deploying"
	// PhaseReady is serving.
	PhaseReady Phase = "Ready"
	// PhaseRefused will not proceed until the declaration or the cluster
	// changes; the message says what to change.
	PhaseRefused Phase = "Refused"
	// PhaseError failed in a way the operator retries.
	PhaseError Phase = "Error"
)

// ConditionReady is true when every component is Ready.
const ConditionReady = "Ready"

// ConditionBackupHealthy is true while the database archives to the bucket
// and its last full backup succeeded. It is never an input to Ready: an
// install whose backups fail still serves, and this condition says so.
const ConditionBackupHealthy = "BackupHealthy"

// ObjectReference names the Kubernetes object a component's status is about.
type ObjectReference struct {
	// Kind is the object's kind.
	Kind string `json:"kind"`
	// Name is the object's name.
	Name string `json:"name"`
	// Namespace is the object's namespace, when it has one.
	// +optional
	Namespace string `json:"namespace,omitempty"`
}

// ComponentStatus is one component's standing.
type ComponentStatus struct {
	// Name is the component: keys, objectStore, database, temporal,
	// frontDoor, identity, server or runner.
	Name string `json:"name"`
	// Phase is where the component stands.
	Phase Phase `json:"phase"`
	// Reason is the one-word cause.
	Reason ComponentReason `json:"reason"`
	// Object is what the message is about.
	// +optional
	Object *ObjectReference `json:"object,omitempty"`
	// Message says what is happening and, when something is wrong, the
	// next step.
	// +optional
	Message string `json:"message,omitempty"`
	// LastTransitionTime is when the phase, reason or object last changed.
	// +optional
	LastTransitionTime metav1.Time `json:"lastTransitionTime,omitempty"`
}

// BackupStatus is where the database's backups stand, in the backup
// plugin's own words.
type BackupStatus struct {
	// ServerName is this install's archive in the bucket: the name a restore
	// gives as spec.database.postgresql.bundled.recoverFrom.serverName.
	// +optional
	ServerName string `json:"serverName,omitempty"`
	// FirstRecoverabilityPoint is the earliest moment the archive can
	// restore to.
	// +optional
	FirstRecoverabilityPoint *metav1.Time `json:"firstRecoverabilityPoint,omitempty"`
	// LastSuccessfulBackup is when the last full backup finished.
	// +optional
	LastSuccessfulBackup *metav1.Time `json:"lastSuccessfulBackup,omitempty"`
	// LastFailure says why the last backup or archive attempt failed, when
	// the latest one did.
	// +optional
	LastFailure string `json:"lastFailure,omitempty"`
	// RestoredFrom names the archive this database was created from, when it
	// was restored.
	// +optional
	RestoredFrom string `json:"restoredFrom,omitempty"`
}

// StigmerStatus is the operator's account of the install.
type StigmerStatus struct {
	// ObservedGeneration is the spec generation this status describes.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	// Phase is the install's standing: the worst of its components'.
	// +optional
	Phase Phase `json:"phase,omitempty"`
	// Version is the Stigmer version the server runs: this operator's own
	// once the server has rolled to it.
	// +optional
	Version string `json:"version,omitempty"`
	// Edition is "open source" or "enterprise".
	// +optional
	Edition string `json:"edition,omitempty"`
	// URL is where people reach Stigmer: the front door's https address, or
	// the port-forward's local one.
	// +optional
	URL string `json:"url,omitempty"`
	// Backup is where the database's backups stand, when it has any.
	// +optional
	Backup *BackupStatus `json:"backup,omitempty"`
	// Components lists each component's standing, in the order they are
	// brought up.
	// +listType=map
	// +listMapKey=name
	// +optional
	Components []ComponentStatus `json:"components,omitempty"`
	// Conditions carry Ready, whose message is the worst-off component's.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// Stigmer is one self-hosted Stigmer install. A cluster holds one.
//
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:shortName=stg
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Version",type=string,JSONPath=`.status.version`
// +kubebuilder:printcolumn:name="Edition",type=string,JSONPath=`.status.edition`
// +kubebuilder:printcolumn:name="URL",type=string,JSONPath=`.status.url`
// +kubebuilder:printcolumn:name="Backup",type=date,JSONPath=`.status.backup.lastSuccessfulBackup`
// +kubebuilder:printcolumn:name="Message",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].message`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
type Stigmer struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +optional
	Spec StigmerSpec `json:"spec,omitempty"`
	// +optional
	Status StigmerStatus `json:"status,omitempty"`
}

// StigmerList is a list of Stigmer.
//
// +kubebuilder:object:root=true
type StigmerList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Stigmer `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Stigmer{}, &StigmerList{})
}
