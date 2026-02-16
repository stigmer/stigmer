# Agent Examples

Real-world Agent configurations for common use cases.

## Table of Contents

- [Minimal Agents](#minimal-agents)
- [Code & Development](#code--development)
- [Data & Analytics](#data--analytics)
- [DevOps & Infrastructure](#devops--infrastructure)
- [Customer Support](#customer-support)
- [Content & Documentation](#content--documentation)
- [Multi-Domain Agents](#multi-domain-agents)

## Minimal Agents

### Simple Assistant

Minimal agent with no tools or skills:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A helpful general-purpose assistant"
  instructions: |
    You are a helpful assistant. Provide clear, accurate, and concise responses.
```

### Assistant with Single Skill

Agent with domain knowledge from a skill:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: writing-assistant
  tags: [writing, content]
spec:
  description: "Helps with writing tasks using style guidelines"
  instructions: |
    You are a writing assistant. Help users create clear, engaging content
    following established writing best practices.
  skill_refs:
    - kind: skill
      org: platform
      slug: writing-guidelines
```

## Code & Development

### Code Reviewer

Reviews pull requests and code changes:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  tags: [code-review, security, quality]
spec:
  description: "Reviews code for quality, security, and best practices"
  icon_url: "https://example.com/icons/code-review.svg"
  instructions: |
    You are a code review expert. Analyze code changes for:
    
    1. **Security vulnerabilities** - SQL injection, XSS, authentication issues
    2. **Code quality** - Readability, maintainability, design patterns
    3. **Performance** - Inefficient algorithms, memory leaks, bottlenecks
    4. **Testing** - Test coverage, edge cases, test quality
    5. **Documentation** - Code comments, API docs, README updates
    
    Provide constructive feedback with specific examples and suggestions.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - get_pull_request
        - create_review_comment
  
  skill_refs:
    - kind: skill
      org: platform
      slug: code-analysis
    - kind: skill
      org: platform
      slug: security-best-practices
```

### API Tester

Tests REST APIs and validates responses:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: api-tester
  tags: [testing, api, automation]
spec:
  description: "Automated API testing and validation"
  instructions: |
    You test REST APIs. For each endpoint:
    1. Send requests with various parameters
    2. Validate response status codes
    3. Check response schema and data types
    4. Test error handling and edge cases
    5. Document any issues found
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: http-client
  
  skill_refs:
    - kind: skill
      org: platform
      slug: api-testing-patterns
  
  env_spec:
    env_vars:
      - name: API_BASE_URL
        description: "Base URL for the API being tested"
        required: true
      - name: API_KEY
        description: "API authentication key"
        required: false
        is_secret: true
```

### Frontend Developer

Builds web applications:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: frontend-developer
  tags: [frontend, react, web-development]
spec:
  description: "Builds modern web applications with React and TypeScript"
  instructions: |
    You are a frontend developer specializing in React and TypeScript.
    
    Build responsive, accessible web applications following:
    - Modern React patterns (hooks, composition)
    - TypeScript best practices
    - Accessibility standards (WCAG 2.1)
    - Performance optimization
    - Component reusability
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: filesystem
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: npm
  
  skill_refs:
    - kind: skill
      org: platform
      slug: react-patterns
    - kind: skill
      org: platform
      slug: typescript-best-practices
```

## Data & Analytics

### Data Analyst

Analyzes data and generates insights:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: data-analyst
  tags: [data, analytics, sql]
spec:
  description: "Analyzes data from databases and generates business insights"
  instructions: |
    You are a data analyst. Help users understand their data by:
    1. Writing efficient SQL queries
    2. Analyzing trends and patterns
    3. Creating visualizations
    4. Providing actionable business insights
    5. Explaining findings in plain language
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: bigquery
      enabled_tools:
        - execute_query
        - list_tables
        - describe_table
  
  skill_refs:
    - kind: skill
      org: acme-corp
      slug: database-schema
    - kind: skill
      org: platform
      slug: sql-best-practices
  
  env_spec:
    env_vars:
      - name: BIGQUERY_PROJECT
        description: "GCP project ID for BigQuery"
        required: true
      - name: BIGQUERY_DATASET
        description: "Default dataset to query"
        required: false
        default_value: "production"
```

### Report Generator

Creates business reports:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: report-generator
  tags: [reporting, analytics, automation]
spec:
  description: "Generates automated business reports with data visualizations"
  instructions: |
    You generate professional business reports. Include:
    - Executive summary
    - Key metrics and KPIs
    - Data visualizations (charts, graphs)
    - Trend analysis
    - Actionable recommendations
    
    Format reports for your audience (executives, managers, analysts).
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: bigquery
      enabled_tools: [execute_query]
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: spreadsheet
  
  skill_refs:
    - kind: skill
      org: acme-corp
      slug: report-templates
    - kind: skill
      org: platform
      slug: data-visualization
```

## DevOps & Infrastructure

### Deployment Manager

Handles safe production deployments:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-manager
  tags: [deployment, devops, automation]
spec:
  description: "Manages safe production deployments with approval workflows"
  instructions: |
    You manage production deployments. Follow this checklist:
    
    1. **Pre-deployment**:
       - Verify all tests pass
       - Check deployment checklist
       - Review recent changes
       - Confirm rollback plan
    
    2. **Deployment**:
       - Deploy to staging first
       - Run smoke tests
       - Monitor metrics
       - Deploy to production with approval
    
    3. **Post-deployment**:
       - Monitor error rates
       - Check performance metrics
       - Verify functionality
       - Document any issues
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - get_workflow_runs
        - trigger_workflow
        - get_deployment_status
      tool_approval_overrides:
        - tool_name: trigger_workflow
          requires_approval: true
          message: "Trigger deployment workflow: {{args.workflow}} to {{args.environment}}"
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: kubernetes
      enabled_tools: [get_pods, get_deployments]
  
  skill_refs:
    - kind: skill
      org: platform
      slug: deployment-checklist
    - kind: skill
      org: acme-corp
      slug: infrastructure-docs
  
  env_spec:
    env_vars:
      - name: GITHUB_TOKEN
        description: "GitHub API token"
        required: true
        is_secret: true
      - name: KUBE_CONTEXT
        description: "Kubernetes context to use"
        required: true
```

### Infrastructure Monitor

Monitors system health and alerts:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: infrastructure-monitor
  tags: [monitoring, alerting, sre]
spec:
  description: "Monitors infrastructure health and responds to alerts"
  instructions: |
    You are an SRE monitoring infrastructure. When alerts trigger:
    
    1. Assess severity and impact
    2. Check system metrics (CPU, memory, disk, network)
    3. Review recent changes and deployments
    4. Identify root cause
    5. Suggest remediation steps
    6. Escalate if needed
    
    Provide clear, actionable information for on-call engineers.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: prometheus
      enabled_tools: [query_metrics, get_alerts]
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: kubernetes
      enabled_tools: [get_pods, get_logs]
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: slack
      enabled_tools: [send_message]
  
  skill_refs:
    - kind: skill
      org: platform
      slug: sre-runbooks
    - kind: skill
      org: acme-corp
      slug: alert-procedures
```

## Customer Support

### Support Agent

Handles customer inquiries:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: customer-support
  tags: [support, customer-service]
spec:
  description: "Provides customer support with access to knowledge base and ticketing"
  instructions: |
    You are a customer support agent. Help customers by:
    
    1. Understanding their issue clearly
    2. Searching knowledge base for solutions
    3. Providing step-by-step guidance
    4. Creating support tickets when needed
    5. Following up to ensure resolution
    
    Be empathetic, patient, and thorough. Escalate complex issues to human agents.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: zendesk
      enabled_tools:
        - search_articles
        - create_ticket
        - update_ticket
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: email
      enabled_tools: [send_email]
      tool_approval_overrides:
        - tool_name: send_email
          requires_approval: true
          message: "Send customer email: {{args.subject}}"
  
  skill_refs:
    - kind: skill
      org: acme-corp
      slug: product-documentation
    - kind: skill
      org: acme-corp
      slug: support-guidelines
```

## Content & Documentation

### Documentation Writer

Creates and maintains documentation:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: doc-writer
  tags: [documentation, writing, technical-writing]
spec:
  description: "Creates clear technical documentation for APIs and products"
  instructions: |
    You are a technical writer. Create documentation that is:
    
    - **Clear**: Use simple language, avoid jargon
    - **Complete**: Cover all features and edge cases
    - **Organized**: Logical structure with good navigation
    - **Accurate**: Up-to-date with current implementation
    - **Helpful**: Include examples and troubleshooting
    
    Follow the documentation style guide for consistency.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_file
        - update_file
  
  skill_refs:
    - kind: skill
      org: acme-corp
      slug: documentation-style-guide
    - kind: skill
      org: platform
      slug: technical-writing-best-practices
```

### Content Moderator

Reviews and moderates user-generated content:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: content-moderator
  tags: [moderation, content, safety]
spec:
  description: "Reviews user-generated content for policy violations"
  instructions: |
    You moderate user-generated content. Check for:
    
    1. **Prohibited content**: Hate speech, violence, illegal activity
    2. **Spam**: Repetitive or promotional content
    3. **Privacy**: Personal information, doxxing
    4. **Copyright**: Unauthorized copyrighted material
    5. **Community guidelines**: Platform-specific rules
    
    When flagging content, explain the specific violation and cite the policy.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: content-api
      enabled_tools:
        - get_content
        - flag_content
        - remove_content
      tool_approval_overrides:
        - tool_name: remove_content
          requires_approval: true
          message: "Remove content: {{args.content_id}} for {{args.reason}}"
  
  skill_refs:
    - kind: skill
      org: acme-corp
      slug: content-policy
    - kind: skill
      org: acme-corp
      slug: moderation-guidelines
```

## Multi-Domain Agents

### Engineering Team Lead

Coordinates multiple sub-agents for engineering tasks:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-lead
  tags: [engineering, coordination, automation]
spec:
  description: "Engineering team lead coordinating code review, testing, and deployment"
  instructions: |
    You are an engineering team lead. Coordinate engineering workflows by
    delegating to specialized sub-agents:
    
    - **code-reviewer**: For code quality and security reviews
    - **test-runner**: For running and analyzing tests
    - **deployment-manager**: For production deployments
    
    Ensure all steps complete successfully before proceeding to the next phase.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - get_pull_request
        - create_review_comment
        - get_workflow_runs
        - trigger_workflow
  
  skill_refs:
    - kind: skill
      org: platform
      slug: engineering-workflow
  
  sub_agents:
    - name: code-reviewer
      description: "Performs detailed code reviews"
      instructions: |
        You review code for quality, security, and best practices.
        Provide specific, actionable feedback.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
            - get_pull_request
            - create_review_comment
      skill_refs:
        - kind: skill
          org: platform
          slug: code-analysis
    
    - name: test-runner
      description: "Runs tests and analyzes results"
      instructions: |
        You run test suites and analyze results. Report failures clearly
        with reproduction steps and suggested fixes.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - get_workflow_runs
      skill_refs:
        - kind: skill
          org: platform
          slug: test-analysis
    
    - name: deployment-manager
      description: "Handles production deployments"
      instructions: |
        You manage production deployments. Verify all checks pass before
        deploying. Monitor post-deployment metrics.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - trigger_workflow
            - get_workflow_runs
      skill_refs:
        - kind: skill
          org: platform
          slug: deployment-checklist
```

### Research Assistant

Multi-domain research with specialized sub-agents:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: research-assistant
  tags: [research, analysis, writing]
spec:
  description: "Research assistant with specialized sub-agents for different domains"
  instructions: |
    You are a research assistant. Coordinate research tasks by delegating to:
    
    - **web-researcher**: For finding and synthesizing online information
    - **data-analyst**: For quantitative analysis and statistics
    - **writer**: For creating well-structured research reports
    
    Combine insights from all sub-agents into comprehensive research deliverables.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: web-search
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: bigquery
      enabled_tools: [execute_query, list_tables]
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: filesystem
  
  sub_agents:
    - name: web-researcher
      description: "Researches topics using web search"
      instructions: |
        You research topics online. Find credible sources, synthesize
        information, and cite your sources.
      mcp_access:
        - mcp_server: web-search
      skill_refs:
        - kind: skill
          org: platform
          slug: research-methods
    
    - name: data-analyst
      description: "Analyzes quantitative data"
      instructions: |
        You analyze data from databases. Run queries, identify trends,
        and provide statistical insights.
      mcp_access:
        - mcp_server: bigquery
          enabled_tools: [execute_query, list_tables]
      skill_refs:
        - kind: skill
          org: platform
          slug: statistical-analysis
    
    - name: writer
      description: "Writes research reports"
      instructions: |
        You write clear, well-structured research reports. Organize
        information logically and present findings professionally.
      mcp_access:
        - mcp_server: filesystem
      skill_refs:
        - kind: skill
          org: platform
          slug: research-writing
```

## Tips for Agent Design

### 1. Clear Instructions

Good instructions are specific and actionable:

```yaml
# ✅ Good - specific and actionable
instructions: |
  You review code for:
  1. Security vulnerabilities (SQL injection, XSS, etc.)
  2. Code quality (readability, maintainability)
  3. Performance issues (inefficient algorithms)
  Provide specific examples and suggestions.

# ❌ Bad - vague and generic
instructions: "You help with code."
```

### 2. Appropriate Tool Access

Only enable tools the agent actually needs:

```yaml
# ✅ Good - specific tools for the task
enabled_tools:
  - search_code
  - get_file
  - create_review_comment

# ❌ Bad - too many unnecessary tools
enabled_tools:
  - search_code
  - get_file
  - create_review_comment
  - delete_repository
  - force_push
  - modify_settings
```

### 3. Sub-Agent Delegation

Use sub-agents for distinct responsibilities:

```yaml
# ✅ Good - clear delegation boundaries
sub_agents:
  - name: code-reviewer
    description: "Reviews code quality"
  - name: security-auditor
    description: "Audits for security issues"

# ❌ Bad - overlapping responsibilities
sub_agents:
  - name: reviewer-1
    description: "Reviews code"
  - name: reviewer-2
    description: "Also reviews code"
```

### 4. Environment Variables

Declare required configuration upfront:

```yaml
# ✅ Good - clear requirements
env_spec:
  env_vars:
    - name: API_BASE_URL
      description: "Base URL for the API"
      required: true
    - name: API_KEY
      description: "API authentication key"
      required: true
      is_secret: true

# ❌ Bad - hardcoded or undeclared
instructions: |
  Use https://api.example.com with key abc123
```

### 5. Appropriate Approvals

Set approval requirements based on risk:

```yaml
# ✅ Good - approval for high-risk operations
tool_approval_overrides:
  - tool_name: delete_repository
    requires_approval: true
    message: "Delete repository: {{args.repo_name}}"
  - tool_name: deploy_production
    requires_approval: true
    message: "Deploy to production: {{args.service}}"

# ✅ Also good - disable for trusted automation
tool_approval_overrides:
  - tool_name: deploy_staging
    requires_approval: false  # Trust automated staging deploys
```
