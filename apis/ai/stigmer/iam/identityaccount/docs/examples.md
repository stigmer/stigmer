# IdentityAccount Examples

Common CLI operations and YAML examples for identity accounts.

## Get the Current Authenticated User

```bash
stigmer identity-account whoami
```

Sample output:

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  id: ia-01HQUSER123
  name: Alice Smith
spec:
  idp_id: "auth0|abc123def456"
  email: alice@example.com
  first_name: Alice
  last_name: Smith
  picture_url: "https://cdn.example.com/alice.jpg"
  is_machine_account: false
  provisioning_mode: direct
```

## Get an Identity Account by ID

```bash
stigmer identity-account get ia-01HQUSER123

# As YAML
stigmer identity-account get ia-01HQUSER123 --output yaml
```

## Update Profile Fields

Only mutable fields (`first_name`, `last_name`, `picture_url`) can be updated. `idp_id`, `email`, `is_machine_account`, `provisioning_mode`, and `identity_provider_ref` are immutable or system-managed.

```yaml
# update-profile.yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  id: ia-01HQUSER123
  name: Alice A. Smith
spec:
  idp_id: "auth0|abc123def456"
  first_name: Alice
  last_name: A. Smith
  picture_url: "https://cdn.example.com/alice-new.jpg"
```

```bash
stigmer identity-account update update-profile.yaml
```

## Federated Account — What It Looks Like

A federated account is created by the platform and has additional fields linking it to the IdentityProvider.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  id: ia-01HQFEDUSER
  name: Bob Jones
spec:
  idp_id: "google-oauth2|109876543210"
  email: bob@partner.example.com
  first_name: Bob
  last_name: Jones
  picture_url: "https://partner.example.com/bob.jpg"
  is_machine_account: false
  provisioning_mode: federated
  identity_provider_ref:
    org: partner-org
    kind: identity_provider
    slug: partner-cloud
```

## Machine Account — What It Looks Like

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  id: ia-01HQMACHINE
  name: deploy-service
spec:
  idp_id: "HqKdZn9xyzABC@clients"
  is_machine_account: true
  provisioning_mode: machine
```

## Recover a Missing Account (Simulate Signup Webhook)

Use this when a user created an Auth0 account but Stigmer did not create their IdentityAccount due to a missed webhook.

```bash
stigmer identity-account simulate-signup-webhook --email alice@example.com
```

## Delete an Identity Account

```bash
stigmer identity-account delete ia-01HQUSER123
```

Deletion removes the IdentityAccount and triggers cleanup of all associated IAM policies via `cleanupResourcePolicies`.
