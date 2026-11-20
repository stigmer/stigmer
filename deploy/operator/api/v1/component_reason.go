// The one-word reasons a component's status carries, as documented string
// constants rather than a closed enum.
//
// A reason is a wire value an adopter's alerting may match on, so a name
// never changes once released; a new cause is a new constant. They are
// constants, not a validation enum, so a newer operator can write a reason
// an older definition has never heard of. ReasonMessages pairs every reason
// with the sentence an adopter reads when it has no more specific one, and
// its test holds that every reason in AllComponentReasons has one.

package v1

// ComponentReason is the one-word cause behind a component's phase.
type ComponentReason string

const (
	// ReasonHealthy: the component is serving.
	ReasonHealthy ComponentReason = "Healthy"
	// ReasonDeploying: the component's objects are applied and converging.
	ReasonDeploying ComponentReason = "Deploying"
	// ReasonWaitingForDependency: a component this one needs is not ready.
	ReasonWaitingForDependency ComponentReason = "WaitingForDependency"
	// ReasonInstallingPrerequisite: a cluster-level operator this one needs
	// is being installed.
	ReasonInstallingPrerequisite ComponentReason = "InstallingPrerequisite"
	// ReasonStartingUp: the pods run but do not answer yet.
	ReasonStartingUp ComponentReason = "StartingUp"
	// ReasonVolumeProvisioning: a claim waits for its volume.
	ReasonVolumeProvisioning ComponentReason = "VolumeProvisioning"
	// ReasonVolumeUnprovisionable: no storage class can bind a claim.
	ReasonVolumeUnprovisionable ComponentReason = "VolumeUnprovisionable"
	// ReasonImagePullFailed: the node cannot pull an image.
	ReasonImagePullFailed ComponentReason = "ImagePullFailed"
	// ReasonContainerConfigInvalid: a container cannot be created from its
	// declaration, usually a Secret or key it reads that does not exist.
	ReasonContainerConfigInvalid ComponentReason = "ContainerConfigInvalid"
	// ReasonOutOfMemory: a container was killed for exceeding its memory limit.
	ReasonOutOfMemory ComponentReason = "OutOfMemory"
	// ReasonCrashLooping: a container keeps exiting with an error.
	ReasonCrashLooping ComponentReason = "CrashLooping"
	// ReasonUnschedulable: no node can take a pod.
	ReasonUnschedulable ComponentReason = "Unschedulable"
	// ReasonVolumeMountFailed: a volume cannot be mounted into a pod.
	ReasonVolumeMountFailed ComponentReason = "VolumeMountFailed"
	// ReasonRolloutStalled: a rollout stopped progressing.
	ReasonRolloutStalled ComponentReason = "RolloutStalled"
	// ReasonCreateRefused: the cluster refused to create a pod.
	ReasonCreateRefused ComponentReason = "CreateRefused"
	// ReasonWaitingForSchema: a schema or setup Job is still running.
	ReasonWaitingForSchema ComponentReason = "WaitingForSchema"
	// ReasonJobFailed: a schema or setup Job failed.
	ReasonJobFailed ComponentReason = "JobFailed"
	// ReasonSecretMissing: a Secret or key the declaration names does not exist.
	ReasonSecretMissing ComponentReason = "SecretMissing"
	// ReasonConfigurationRefused: the declaration cannot be carried out as
	// written.
	ReasonConfigurationRefused ComponentReason = "ConfigurationRefused"
	// ReasonSizingRefused: a declared size no workload can run with.
	ReasonSizingRefused ComponentReason = "SizingRefused"
	// ReasonAnotherStigmer: the cluster already holds a Stigmer.
	ReasonAnotherStigmer ComponentReason = "AnotherStigmer"
	// ReasonModelKeyMissing: agents cannot run until a model key is given.
	ReasonModelKeyMissing ComponentReason = "ModelKeyMissing"
	// ReasonCertificatePending: the front door waits for its certificate.
	ReasonCertificatePending ComponentReason = "CertificatePending"
	// ReasonFrontDoorPending: the front door waits for its controller to
	// serve it.
	ReasonFrontDoorPending ComponentReason = "FrontDoorPending"
	// ReasonGatewayNotAccepted: the Gateway's controller refused a route.
	ReasonGatewayNotAccepted ComponentReason = "GatewayNotAccepted"
	// ReasonPerSessionRunnersOnly: a licensed install runs agents in
	// per-session sandboxes, not on a shared runner.
	ReasonPerSessionRunnersOnly ComponentReason = "PerSessionRunnersOnly"
	// ReasonPerSessionSandboxes: agents run in per-session sandboxes, so no
	// shared runner is rendered.
	ReasonPerSessionSandboxes ComponentReason = "PerSessionSandboxes"
	// ReasonRealmConverging: the bundled sign-in's realm is being set up.
	ReasonRealmConverging ComponentReason = "RealmConverging"
	// ReasonPrerequisiteMissing: a cluster-level piece the declaration needs
	// is not installed, and the operator never installs it (cert-manager).
	ReasonPrerequisiteMissing ComponentReason = "PrerequisiteMissing"
	// ReasonWaitingForBackupPlugin: a new database waits for the backup
	// plugin so it is born archiving.
	ReasonWaitingForBackupPlugin ComponentReason = "WaitingForBackupPlugin"
	// ReasonBackingUpBeforeUpgrade: an upgrade waits for a backup of the
	// database it is about to migrate.
	ReasonBackingUpBeforeUpgrade ComponentReason = "BackingUpBeforeUpgrade"
	// ReasonUpgradeBackupFailed: the backup an upgrade waits for failed, so
	// the upgrade is held.
	ReasonUpgradeBackupFailed ComponentReason = "UpgradeBackupFailed"
	// ReasonReconcileFailed: the operator hit an error it retries.
	ReasonReconcileFailed ComponentReason = "ReconcileFailed"
)

// AllComponentReasons lists every reason, in the order the documentation
// shows them.
func AllComponentReasons() []ComponentReason {
	return []ComponentReason{
		ReasonHealthy,
		ReasonDeploying,
		ReasonWaitingForDependency,
		ReasonInstallingPrerequisite,
		ReasonStartingUp,
		ReasonVolumeProvisioning,
		ReasonVolumeUnprovisionable,
		ReasonImagePullFailed,
		ReasonContainerConfigInvalid,
		ReasonOutOfMemory,
		ReasonCrashLooping,
		ReasonUnschedulable,
		ReasonVolumeMountFailed,
		ReasonRolloutStalled,
		ReasonCreateRefused,
		ReasonWaitingForSchema,
		ReasonJobFailed,
		ReasonSecretMissing,
		ReasonConfigurationRefused,
		ReasonSizingRefused,
		ReasonAnotherStigmer,
		ReasonModelKeyMissing,
		ReasonCertificatePending,
		ReasonFrontDoorPending,
		ReasonGatewayNotAccepted,
		ReasonRealmConverging,
		ReasonPerSessionRunnersOnly,
		ReasonPerSessionSandboxes,
		ReasonPrerequisiteMissing,
		ReasonWaitingForBackupPlugin,
		ReasonBackingUpBeforeUpgrade,
		ReasonUpgradeBackupFailed,
		ReasonReconcileFailed,
	}
}

// ReasonMessages is the sentence for each reason when a component has no
// more specific one.
var ReasonMessages = map[ComponentReason]string{
	ReasonHealthy:                "serving",
	ReasonDeploying:              "applied; waiting for it to come up",
	ReasonWaitingForDependency:   "waiting for a component it needs",
	ReasonInstallingPrerequisite: "installing a cluster-level operator it needs",
	ReasonStartingUp:             "running, not yet answering",
	ReasonVolumeProvisioning:     "waiting for its volume to be provisioned",
	ReasonVolumeUnprovisionable:  "no storage class can provision its volume: name one that exists, or give the cluster a default",
	ReasonImagePullFailed:        "the node cannot pull its image: check the registry, the tag and the pull secrets",
	ReasonContainerConfigInvalid: "a container cannot be created: a Secret or key it reads is missing",
	ReasonOutOfMemory:            "killed for exceeding its memory limit: raise the limit",
	ReasonCrashLooping:           "keeps exiting with an error: its last lines say why",
	ReasonUnschedulable:          "no node can take its pod: add capacity or lower the requests",
	ReasonVolumeMountFailed:      "a volume cannot be mounted",
	ReasonRolloutStalled:         "its rollout stopped progressing",
	ReasonCreateRefused:          "the cluster refused to create its pod (a quota or an admission policy)",
	ReasonWaitingForSchema:       "setting up its database schema",
	ReasonJobFailed:              "a setup job failed: its logs say why",
	ReasonSecretMissing:          "a Secret the declaration names does not exist",
	ReasonConfigurationRefused:   "the declaration cannot be carried out as written",
	ReasonSizingRefused:          "a declared size cannot run",
	ReasonAnotherStigmer:         "this cluster already runs a Stigmer",
	ReasonModelKeyMissing:        "agents cannot run until the runner has a model key",
	ReasonCertificatePending:     "the front door waits for its certificate",
	ReasonFrontDoorPending:       "the front door waits for its controller to serve it",
	ReasonGatewayNotAccepted:     "the Gateway's controller refused the front door's routes",
	ReasonRealmConverging:        "setting up the sign-in's realm, clients and owner",
	ReasonPerSessionRunnersOnly:  "a licensed server runs agents in per-session sandboxes, not on a shared runner",
	ReasonPerSessionSandboxes:    "agents run in per-session sandboxes, so there is no shared runner",
	ReasonPrerequisiteMissing:    "a cluster-level piece it needs is not installed: install it",
	ReasonWaitingForBackupPlugin: "waiting for the backup plugin, so the database is born archiving",
	ReasonBackingUpBeforeUpgrade: "taking a backup before the server migrates its database forward",
	ReasonUpgradeBackupFailed:    "the backup before the upgrade failed, so the upgrade is held",
	ReasonReconcileFailed:        "the operator hit an error and will retry",
}

// IsFailure reports whether a reason means something is wrong, rather than
// still converging; the controller records a Warning Event for these.
func (r ComponentReason) IsFailure() bool {
	switch r {
	case ReasonVolumeUnprovisionable, ReasonImagePullFailed, ReasonContainerConfigInvalid,
		ReasonOutOfMemory, ReasonCrashLooping, ReasonUnschedulable, ReasonVolumeMountFailed,
		ReasonRolloutStalled, ReasonCreateRefused, ReasonJobFailed, ReasonSecretMissing,
		ReasonConfigurationRefused, ReasonSizingRefused, ReasonAnotherStigmer,
		ReasonModelKeyMissing, ReasonReconcileFailed, ReasonPrerequisiteMissing, ReasonUpgradeBackupFailed,
		ReasonGatewayNotAccepted:
		return true
	}
	return false
}
