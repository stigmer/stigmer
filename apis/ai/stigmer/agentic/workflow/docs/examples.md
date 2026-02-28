# Workflow Examples

Complete, working workflow YAML examples from minimal single-task workflows to multi-agent pipelines. All examples can be applied directly with `stigmer apply`.

---

## Minimal Workflow

The simplest possible workflow — one task, no exports, no branching.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: hello-world
  org: local
spec:
  description: "Sends a single HTTP request"
  document:
    dsl: "1.0.0"
    namespace: examples
    name: hello-world
    version: "1.0.0"
  tasks:
    - name: ping
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://httpbin.org/get"
```

**Apply:**
```bash
stigmer apply workflow.yaml
```

---

## Set Variables and HTTP Call

Initialize variables, then use them in a downstream HTTP request.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: fetch-user-profile
  org: acme-corp
spec:
  description: "Fetches a user profile by ID and logs the result"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: fetch-user-profile
    version: "1.0.0"
  env_spec:
    variables:
      - name: USER_ID
        required: true
      - name: API_TOKEN
        required: true
  tasks:
    - name: init
      kind: set_vars
      task_config:
        variables:
          requestedAt: "${now}"
          userId: "${.env.USER_ID}"
      flow:
        then: fetchProfile

    - name: fetchProfile
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://api.acme.com/users/${$context.userId}"
        headers:
          Authorization: "Bearer ${.env.API_TOKEN}"
      export:
        as: "${.body}"
      flow:
        then: logResult

    - name: logResult
      kind: activity_call
      task_config:
        activity: "AuditLogActivity"
        input:
          userId: "${$context.userId}"
          email: "${$context.fetchProfile.email}"
          requestedAt: "${$context.requestedAt}"
```

---

## Conditional Branching

Route execution based on an API response using `switch_case`.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: order-processor
  org: acme-corp
spec:
  description: "Processes an order: validates, charges, or rejects based on status"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: order-processor
    version: "1.0.0"
  env_spec:
    variables:
      - name: ORDER_ID
        required: true
      - name: PAYMENTS_API_URL
        required: true
  tasks:
    - name: fetchOrder
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "${.env.PAYMENTS_API_URL}/orders/${.env.ORDER_ID}"
      export:
        as: "${.body}"
      flow:
        then: routeOrder

    - name: routeOrder
      kind: switch_case
      task_config:
        cases:
          - name: approved
            when: "${$context.fetchOrder.status == \"approved\"}"
            then: chargeCustomer
          - name: pending
            when: "${$context.fetchOrder.status == \"pending\"}"
            then: sendPendingNotification
          - name: rejected
            then: rejectOrder

    - name: chargeCustomer
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "${.env.PAYMENTS_API_URL}/charges"
        body:
          orderId: "${$context.fetchOrder.id}"
          amount: "${$context.fetchOrder.totalCents}"
          currency: "${$context.fetchOrder.currency}"
      export:
        as: "${.body}"
      flow:
        then: end

    - name: sendPendingNotification
      kind: activity_call
      task_config:
        activity: "SendEmailActivity"
        input:
          to: "${$context.fetchOrder.customer.email}"
          subject: "Your order is pending review"
          body: "Order ${$context.fetchOrder.id} is under review. We'll update you shortly."
      flow:
        then: end

    - name: rejectOrder
      kind: raise_error
      task_config:
        error: "OrderRejected"
        message: "Order ${$context.fetchOrder.id} was rejected: ${$context.fetchOrder.rejectionReason}"
```

---

## Loop: Process Each Item

Iterate over a collection returned by an API and process each item with an agent.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: batch-code-review
  org: acme-corp
spec:
  description: "Fetches open PRs and runs a code review agent on each"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: batch-code-review
    version: "1.0.0"
  env_spec:
    variables:
      - name: GITHUB_ORG
        required: true
      - name: GITHUB_REPO
        required: true
      - name: GITHUB_TOKEN
        required: true
  tasks:
    - name: fetchOpenPRs
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://api.github.com/repos/${.env.GITHUB_ORG}/${.env.GITHUB_REPO}/pulls?state=open"
        headers:
          Authorization: "Bearer ${.env.GITHUB_TOKEN}"
          Accept: "application/vnd.github.v3+json"
      export:
        as: "${.body}"
      flow:
        then: reviewEachPR

    - name: reviewEachPR
      kind: for_each
      task_config:
        each: pr
        in: "${$context.fetchOpenPRs}"
        do:
          - name: reviewPR
            kind: agent_call
            task_config:
              agent: "code-reviewer"
              message: "Review pull request #${$data.pr.number}: ${$data.pr.title}\n\nDiff URL: ${$data.pr.diff_url}\n\nFocus on security, correctness, and adherence to our coding standards."
              env:
                GITHUB_TOKEN: "${.env.GITHUB_TOKEN}"
            export:
              as: "${.}"
          - name: postComment
            kind: http_call
            task_config:
              method: POST
              endpoint:
                uri: "https://api.github.com/repos/${.env.GITHUB_ORG}/${.env.GITHUB_REPO}/issues/${$data.pr.number}/comments"
              headers:
                Authorization: "Bearer ${.env.GITHUB_TOKEN}"
                Content-Type: "application/json"
              body:
                body: "${$context.reviewPR.response}"
```

---

## Parallel Execution

Run independent checks in parallel using `fork`, then consolidate results.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: deployment-preflight
  org: acme-corp
spec:
  description: "Runs security scan, dependency audit, and load test in parallel before deploying"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: deployment-preflight
    version: "1.0.0"
  env_spec:
    variables:
      - name: BUILD_ID
        required: true
      - name: SECURITY_API_URL
        required: true
  tasks:
    - name: parallelChecks
      kind: fork
      task_config:
        compete: false
        branches:
          - name: securityScan
            do:
              - name: runScan
                kind: http_call
                task_config:
                  method: POST
                  endpoint:
                    uri: "${.env.SECURITY_API_URL}/scans"
                  body:
                    buildId: "${.env.BUILD_ID}"
                export:
                  as: "${.body}"

          - name: dependencyAudit
            do:
              - name: runAudit
                kind: activity_call
                task_config:
                  activity: "DependencyAuditActivity"
                  input:
                    buildId: "${.env.BUILD_ID}"
                export:
                  as: "${.}"

          - name: performanceCheck
            do:
              - name: runLoadTest
                kind: http_call
                task_config:
                  method: POST
                  endpoint:
                    uri: "https://loadtest.acme.com/runs"
                  body:
                    buildId: "${.env.BUILD_ID}"
                    duration: 60
                    users: 100
                export:
                  as: "${.body}"
      flow:
        then: evaluateResults

    - name: evaluateResults
      kind: switch_case
      task_config:
        cases:
          - name: allClear
            when: "${$context.runScan.passed == true and $context.runAudit.passed == true and $context.runLoadTest.p99LatencyMs < 500}"
            then: triggerDeploy
          - name: blocked
            then: notifyBlocked

    - name: triggerDeploy
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://deploy.acme.com/deployments"
        body:
          buildId: "${.env.BUILD_ID}"
          environment: "production"
      flow:
        then: end

    - name: notifyBlocked
      kind: activity_call
      task_config:
        activity: "SendEmailActivity"
        input:
          to: "platform-team@acme.com"
          subject: "Deployment blocked: preflight checks failed"
          body: "Build ${.env.BUILD_ID} failed preflight. Security: ${$context.runScan.passed}, Audit: ${$context.runAudit.passed}, P99: ${$context.runLoadTest.p99LatencyMs}ms"
```

---

## Human-in-the-Loop Approval

Pause execution, wait for an external approval signal, then continue or abort.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: production-deploy-with-approval
  org: acme-corp
spec:
  description: "Deploys to production only after an explicit human approval signal"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: production-deploy-with-approval
    version: "1.0.0"
  env_spec:
    variables:
      - name: BUILD_ID
        required: true
      - name: APPROVER_EMAIL
        required: true
  tasks:
    - name: requestApproval
      kind: activity_call
      task_config:
        activity: "SendEmailActivity"
        input:
          to: "${.env.APPROVER_EMAIL}"
          subject: "Approval required: Deploy build ${.env.BUILD_ID} to production"
          body: "Please approve or reject this deployment at https://dashboard.acme.com/approvals/${.env.BUILD_ID}"
      flow:
        then: waitForApproval

    - name: waitForApproval
      kind: listen
      task_config:
        to:
          mode: one
          signals:
            - id: deploy_approved
              type: signal
            - id: deploy_rejected
              type: signal
      export:
        as: "${.}"
      flow:
        then: checkDecision

    - name: checkDecision
      kind: switch_case
      task_config:
        cases:
          - name: approved
            when: "${$context.waitForApproval.signal == \"deploy_approved\"}"
            then: deploy
          - name: rejected
            then: notifyRejected

    - name: deploy
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://deploy.acme.com/deployments"
        body:
          buildId: "${.env.BUILD_ID}"
          environment: "production"
          approvedBy: "${$context.waitForApproval.approver}"
      flow:
        then: end

    - name: notifyRejected
      kind: raise_error
      task_config:
        error: "DeploymentRejected"
        message: "Deployment of build ${.env.BUILD_ID} was rejected by ${$context.waitForApproval.approver}"
```

---

## Error Handling with Retry Logic

Wrap a flaky external call in `try_catch` with a retry delay.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: resilient-api-call
  org: acme-corp
spec:
  description: "Calls an external API with automatic retry on failure"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: resilient-api-call
    version: "1.0.0"
  env_spec:
    variables:
      - name: EXTERNAL_API_URL
        required: true
      - name: MAX_ATTEMPTS
        required: false
        default: "3"
  tasks:
    - name: init
      kind: set_vars
      task_config:
        variables:
          attempt: "1"
      flow:
        then: attemptCall

    - name: attemptCall
      kind: try_catch
      task_config:
        try:
          - name: callApi
            kind: http_call
            task_config:
              method: POST
              endpoint:
                uri: "${.env.EXTERNAL_API_URL}/process"
              body:
                attempt: "${$context.attempt}"
              timeout_seconds: 15
            export:
              as: "${.body}"
        catch:
          as: callError
          do:
            - name: checkRetry
              kind: switch_case
              task_config:
                cases:
                  - name: canRetry
                    when: "${$context.attempt | tonumber < (.env.MAX_ATTEMPTS | tonumber)}"
                    then: incrementAndRetry
                  - name: exhausted
                    then: failPermanently

    - name: incrementAndRetry
      kind: set_vars
      task_config:
        variables:
          attempt: "${($context.attempt | tonumber) + 1 | tostring}"
      flow:
        then: waitBeforeRetry

    - name: waitBeforeRetry
      kind: wait
      task_config:
        duration:
          seconds: 30
      flow:
        then: attemptCall

    - name: failPermanently
      kind: raise_error
      task_config:
        error: "MaxRetriesExceeded"
        message: "API call failed after ${.env.MAX_ATTEMPTS} attempts: ${$context.callError.message}"
```

---

## Multi-Agent Pipeline

Chain multiple specialized agents, passing output from one into the prompt of the next.

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: content-pipeline
  org: acme-corp
spec:
  description: "Drafts, reviews, and publishes a blog post using specialized agents"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: content-pipeline
    version: "1.0.0"
  env_spec:
    variables:
      - name: TOPIC
        required: true
      - name: TARGET_AUDIENCE
        required: true
      - name: CMS_API_URL
        required: true
      - name: CMS_API_TOKEN
        required: true
  tasks:
    - name: draft
      kind: agent_call
      task_config:
        agent: "content-writer"
        message: "Write a 1000-word blog post about: ${.env.TOPIC}\n\nTarget audience: ${.env.TARGET_AUDIENCE}\n\nFormat: Markdown with a compelling title, introduction, 3-4 body sections, and conclusion."
        config:
          model: "claude-3-5-sonnet"
          temperature: 0.8
      export:
        as: "${.response}"
      flow:
        then: review

    - name: review
      kind: agent_call
      task_config:
        agent: "content-editor"
        message: "Review and improve the following blog post draft. Fix grammar, improve clarity, ensure the tone matches the target audience (${.env.TARGET_AUDIENCE}), and verify the content is accurate.\n\nDraft:\n\n${$context.draft}"
        config:
          model: "claude-3-5-sonnet"
          temperature: 0.3
      export:
        as: "${.response}"
      flow:
        then: seoOptimize

    - name: seoOptimize
      kind: agent_call
      task_config:
        agent: "seo-optimizer"
        message: "Add SEO metadata to this blog post. Generate: title tag (≤60 chars), meta description (≤160 chars), 5-7 target keywords, and suggested URL slug.\n\nPost:\n\n${$context.review}"
        config:
          temperature: 0.2
      export:
        as: "${.response}"
      flow:
        then: publish

    - name: publish
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "${.env.CMS_API_URL}/posts"
        headers:
          Authorization: "Bearer ${.env.CMS_API_TOKEN}"
          Content-Type: "application/json"
        body:
          content: "${$context.review}"
          seo: "${$context.seoOptimize}"
          status: "draft"
          topic: "${.env.TOPIC}"
      export:
        as: "${.body}"
```

---

## Sub-Workflow Composition

Break a complex process into reusable sub-workflows.

```yaml
# Parent workflow: user-onboarding.yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: user-onboarding
  org: acme-corp
spec:
  description: "Full user onboarding: account setup, notifications, and trial activation"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: user-onboarding
    version: "1.0.0"
  env_spec:
    variables:
      - name: USER_ID
        required: true
      - name: USER_EMAIL
        required: true
      - name: PLAN
        required: true
  tasks:
    - name: setupAccount
      kind: run_workflow
      task_config:
        workflow: "account-setup"
        input:
          userId: "${.env.USER_ID}"
          email: "${.env.USER_EMAIL}"
      export:
        as: "${.}"
      flow:
        then: sendWelcome

    - name: sendWelcome
      kind: run_workflow
      task_config:
        workflow: "welcome-email-sequence"
        input:
          userId: "${.env.USER_ID}"
          email: "${.env.USER_EMAIL}"
          plan: "${.env.PLAN}"
      flow:
        then: activateTrial

    - name: activateTrial
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://billing.acme.com/trials"
        body:
          userId: "${.env.USER_ID}"
          plan: "${.env.PLAN}"
          accountId: "${$context.setupAccount.accountId}"
```

---

## Iterative Development Workflow

Typical development cycle for a new workflow:

```bash
# 1. Write the workflow YAML
cat > my-workflow.yaml << 'EOF'
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: my-workflow
  org: local
spec:
  document:
    dsl: "1.0.0"
    namespace: local
    name: my-workflow
    version: "1.0.0"
  tasks:
    - name: test
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://httpbin.org/get"
EOF

# 2. Preview without applying
stigmer apply my-workflow.yaml --dry-run

# 3. Apply to the platform
stigmer apply my-workflow.yaml

# 4. Wait for validation
stigmer get workflow my-workflow --output yaml | grep -A 3 "state:"
# state: VALID

# 5. Check for warnings
stigmer get workflow my-workflow --output yaml | grep -A 5 warnings

# 6. Iterate — edit, re-apply
stigmer apply my-workflow.yaml

# 7. When ready for production, set visibility to public
# (update metadata.visibility: visibility_public in YAML and re-apply)
```
