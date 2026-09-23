A Team is a named group of an organization's people that access is shared
with as one. Sharing an agent, a workflow, a skill or a channel with a team
gives every member the access the share names; someone who joins the team
gains it, and someone who leaves the team or the organization loses it at
once.

A team belongs to its organization, and only the organization's members can be
in it. People join and leave a team through the IAM policy service, by being
granted or revoked the `member` role on it. Teams are served by Stigmer
Enterprise and Stigmer Cloud.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: Team
metadata:
  name: Site Reliability
  slug: sre
  org: acme
spec:
  description: On-call engineers who run the production agents.
```
