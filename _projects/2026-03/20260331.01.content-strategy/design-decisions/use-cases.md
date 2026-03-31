# Use case library

This document catalogues five industry-specific use cases that demonstrate
Stigmer's breadth. Each follows the same lens: a SaaS founder adding an AI
agent feature to their platform.

**Status**: draft, pending review
**Created**: 2026-03-31
**Depends on**: [Positioning document](positioning.md), [Vocabulary guide](../../../../docs/vocabulary.md), [Demo story narrative](demo-story.md)
**Scope**: Use case strategy and summary narratives. Does not cover visual
design, card layouts, or page templates (Phase 2).

## How to use this document

- **Building the sales site (Phase 2)?** The [Phase 2 notes](#phase-2-notes)
  provide card-ready titles and one-liners for the homepage "What You Can Build"
  section. The full use case entries provide source material for the `/use-cases`
  page.
- **Writing docs or tutorials?** Use the scenarios as motivation: "Imagine you
  build a healthcare platform and want to add..." The proof interactions show
  what success looks like.
- **Evaluating a new use case?** Check it against [the pattern](#the-pattern).
  If the platform has per-tenant knowledge, system actions, and risk-graduated
  decisions, it fits.

### Relationship to other documents

- The [demo story narrative](demo-story.md) owns the deep before/after arc
  (e-commerce, with property management and logistics variant sketches). This
  document does not duplicate those industries.
- The [positioning document](positioning.md) is the source of truth for all
  messaging claims. Every capability statement here traces back to a messaging
  pillar.
- The [vocabulary guide](../../../../docs/vocabulary.md) governs all
  terminology. This document uses the sales-site register throughout.

### Vocabulary contract

Per the [vocabulary guide](../../../../docs/vocabulary.md), sales-site column:

| Concept | Use this | Not this |
|---------|----------|----------|
| Skills | domain knowledge | Skill, knowledge artifact |
| MCP Servers | tools, tool access | MCP server, tool connection |
| Sessions | conversation | Session, thread |
| Approval flows | approval flow | HITL, human-in-the-loop |
| Agent Execution | *(do not mention)* | execution, run |
| Durable Execution | keeps running even if something crashes | Durable Execution, Temporal |

---

## The pattern

Before the specific industries: what makes any platform a good fit for
Stigmer?

Three conditions. If a platform meets all three, it is a strong candidate. If
it meets two, it is still worth exploring. If it meets one, a simpler solution
is probably enough.

### 1. Per-tenant domain knowledge

The platform serves multiple tenants — customers, merchants, clinics,
companies — and each tenant has their own rules, policies, and procedures. A
generic AI model does not know these rules. The agent needs to be taught each
tenant's domain.

*Maps to*: Pillar 1, "Knows Your Business."

### 2. System actions

The agent needs to do more than answer questions. It needs to look up records,
create tickets, update statuses, send notifications — actions in the platform's
own systems. Without tool access, the agent is a dead end that sounds helpful
but cannot help.

*Maps to*: Pillar 2, "Uses Your Tools."

### 3. Risk-graduated decisions

Some actions are routine. Others are sensitive — financial, legal, medical,
contractual. The platform needs to decide where the line is: what the agent
handles on its own and what requires a human decision. Without this, the agent
is either too cautious (asks about everything) or too autonomous (acts without
oversight on things that matter).

*Maps to*: Pillar 3, "Asks Before Acting."

### The foundation underneath

All three conditions assume the agent runs reliably — it remembers past
conversations, survives crashes, and handles long-running processes without
losing state. This is not a feature the builder chooses to add. It is a
requirement that Stigmer meets by default.

*Maps to*: Foundation, "Built for Production."

### Does this sound like your platform?

If you find yourself nodding at two or three of these conditions, the use cases
below will feel familiar. If your industry is not listed, the pattern still
applies — the five examples are illustrations, not an exhaustive list.

---

## Use cases

### Healthcare SaaS — Patient intake and triage agent

**The builder**: You build clinic management software. Multi-location practices
use your platform for scheduling, patient records, and billing. You want to add
a patient-facing agent to the portal so clinics can handle routine requests
without tying up front-desk staff.

**The challenge**: Patients call with refill requests, appointment questions,
and symptom concerns. You added a chatbot, but it gives generic medical advice.
It does not know each clinic's triage protocols, available services, or
physician specialties. It cannot tell a routine scheduling request from
something that needs clinical attention. Patients get bad answers and call the
clinic anyway.

**How Stigmer powers it**:

- Each clinic uploads its own protocols — triage guidelines, available services,
  physician specialties, appointment policies. The agent answers questions
  specific to that clinic.
- The agent connects to the clinic's scheduling and patient records systems. It
  checks appointment availability, submits intake forms, and initiates
  prescription refills.
- Clinical decisions — symptom escalations, medication-related questions —
  require physician or nurse review. Routine scheduling and refill requests are
  handled automatically.

**Proof interaction**:

*"I need to refill my blood pressure medication."*

→ *"Your Lisinopril 10mg is eligible for refill — your last appointment was
within the 90-day window. I've sent the refill request to Dr. Patel for
approval."*

**The outcome**: Every clinic on your platform has a patient-facing agent that
knows their protocols, handles routine requests, and routes clinical decisions
to the right physician. Your clinics spend less time on phone calls. Their
patients get faster, accurate answers.

---

### HR / People platform — Employee onboarding assistant

**The builder**: You build HR software for mid-size companies. Your clients use
the platform for hiring, onboarding, benefits enrollment, and time tracking.
You want to add an AI onboarding guide so every new hire gets a consistent,
personalized experience from day one.

**The challenge**: Onboarding is a multi-week process — paperwork, system
access, equipment requests, policy acknowledgments, training assignments. Each
client company has different policies, benefits packages, and procedures. HR
teams walk every new hire through the same steps manually. It is slow,
error-prone, and does not scale. You tried a chatbot, but it gives generic
onboarding advice that does not match any specific company's policies.

**How Stigmer powers it**:

- Each company uploads its own onboarding materials — employee handbook,
  benefits guide, IT access policies, training requirements by role. The agent
  answers questions specific to that company.
- The agent connects to your platform's systems — submits IT access requests,
  enrolls new hires in benefits, assigns training modules, and tracks
  completion.
- Onboarding runs as a multi-step automation: day-one tasks, week-one
  checkpoints, 30-day review. The agent guides the new hire through each phase
  and picks up where it left off if anything is interrupted.
- Equipment requests need manager approval. Standard access and training
  tasks are handled automatically.

**Proof interaction**:

*"What health insurance options do I have?"*

→ *"Acme Corp offers three plans: Basic ($0/month, $3,000 deductible), Plus
($120/month, $1,500 deductible), and Premium ($280/month, $500 deductible).
Your enrollment deadline is April 15. Would you like me to start your
enrollment?"*

**The outcome**: Every company on your platform has an onboarding agent that
knows their policies, walks new hires through each step, and keeps the process
moving without HR intervention. Your clients onboard faster. Their new hires
feel supported from the first day.

---

### FinTech / Banking-as-a-Service — Compliance monitoring agent

**The builder**: You build a banking-as-a-service platform. Fintechs and
neobanks use it to offer banking products — accounts, payments, lending —
without building their own banking infrastructure. You want to add an AI
compliance agent so your clients can monitor transactions against their own
regulatory rules.

**The challenge**: Every client has different compliance requirements depending
on their products, jurisdictions, and risk profiles. Transaction monitoring is
mandatory, but the thresholds and rules differ. Manual compliance review is
expensive and slow. You added an AI assistant, but it does not know each
client's specific thresholds, reporting obligations, or risk categories. It
produces generic alerts that still require full manual review.

**How Stigmer powers it**:

- Each client uploads their compliance rules — transaction thresholds, reporting
  triggers, risk categories, jurisdiction-specific requirements. The agent
  evaluates transactions against the right client's rules, not a generic
  rulebook.
- The agent connects to the transaction ledger and identity verification
  systems. It flags transactions, pulls customer profiles, and generates
  preliminary compliance reports.
- Flagging a transaction as suspicious or filing a regulatory report requires
  compliance officer review. Routine monitoring and low-risk alerts are handled
  automatically.

**Proof interaction**:

*"Summarize today's flagged transactions for NeoBank."*

→ *"NeoBank had 3 flagged transactions today. Two are velocity alerts — the
same account made 12 transfers in 4 hours, exceeding NeoBank's 8-per-day
threshold. One is a cross-border payment to a jurisdiction on NeoBank's
enhanced-review list. All three are pending your review."*

**The outcome**: Every client on your platform has a compliance agent that knows
their regulatory rules, monitors transactions in real time, and routes
decisions to the right compliance officer. Your clients reduce review time.
Their compliance teams focus on the cases that matter.

---

### EdTech — Course tutor and academic assistant

**The builder**: You build an online learning platform. Instructors create
courses, students enroll, and your platform handles content delivery,
assignments, and grading. You want to add an AI tutor so every course has
always-available academic support.

**The challenge**: Students get stuck and need help outside class hours.
Instructors cannot answer every question individually. You added a chatbot, but
it gives generic educational advice that does not match the specific course
content, grading rubric, or academic policies. Worse, it has no memory — a
student who asked about assignment 3 yesterday has to re-explain the context
today.

**How Stigmer powers it**:

- Each course has its own knowledge — syllabus, lecture notes, assignment
  rubrics, grading policies, academic integrity rules. The agent answers
  questions specific to that course's content and standards.
- The agent connects to the learning management system. It checks assignment
  submissions, looks up grades, and flags questions for the instructor when the
  answer is not covered by the course materials.
- Conversations persist across weeks. A student working through a multi-week
  project can ask follow-up questions days apart, and the agent picks up where
  they left off — no re-explanation needed.

**Proof interaction**:

*"I'm confused about the regression analysis in my project. We talked about
this last Tuesday."*

→ *"Right — last time we worked through your dataset's multicollinearity issue.
Your next step was to apply variance inflation factors. Did you get a chance to
run that, or would you like to walk through it together?"*

**The outcome**: Every course on your platform has a tutoring agent that knows
the course material, remembers each student's progress, and provides help at
any hour. Your instructors handle fewer repetitive questions. Their students
get support that builds on previous conversations instead of starting over
every time.

---

### Legal tech — Contract analysis agent

**The builder**: You build contract lifecycle management software. Law firms
and corporate legal departments use your platform to draft, review, negotiate,
and manage contracts. You want to add an AI contract analyst so attorneys can
review agreements faster without missing deviations from their standards.

**The challenge**: Contract review is the most time-consuming part of legal
work. Attorneys compare clauses against precedent, check for non-standard
language, and flag risk — manually, for every agreement. You added an AI
assistant, but it does not know the firm's clause library, risk tolerance, or
review standards. It produces generic analysis that still requires full attorney
review, saving no time.

**How Stigmer powers it**:

- Each firm or legal department uploads its own clause library, risk policies,
  and review standards. The agent compares incoming contracts against the firm's
  specific precedent, not generic legal templates.
- The agent connects to the contract management system. It pulls active
  contracts, compares clause versions, and annotates documents with findings.
- Recommendations that affect legal liability — accepting non-standard
  indemnification, modifying IP assignment, waiving limitation of liability —
  require attorney approval. Standard clause comparisons and risk flagging are
  handled automatically.

**Proof interaction**:

*"Review the indemnification clause in the Meridian contract."*

→ *"The Meridian contract uses mutual uncapped indemnification. Your firm's
standard is mutual capped indemnification limited to 2x contract value. This is
a material deviation — I've flagged it for your review with a recommended
redline."*

**The outcome**: Every firm on your platform has a contract analysis agent that
knows their clause library, compares incoming agreements against their
standards, and pauses for attorney review on material deviations. Your clients
review contracts faster. Their attorneys focus on judgment calls, not
repetitive clause comparison.

---

## Capability coverage matrix

This table maps each use case to the three messaging pillars and the
foundation capabilities. It validates that the five use cases collectively
cover all of Stigmer's capabilities, and gives Phase 2 a quick reference for
which use case to feature alongside which pillar.

| Use case | Knows Your Business | Uses Your Tools | Asks Before Acting | Conversations | Multi-step automation | Reliability |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| Healthcare SaaS | ● | ● | ◉ | ○ | ○ | ● |
| HR / People platform | ● | ● | ● | ○ | ◉ | ● |
| FinTech / BaaS | ◉ | ● | ● | ○ | ○ | ● |
| EdTech | ● | ● | ○ | ◉ | ○ | ● |
| Legal tech | ◉ | ● | ◉ | ○ | ○ | ● |

◉ = primary showcase for this use case.
● = present and significant.
○ = minor or implied.

Every messaging pillar appears as a primary showcase (◉) in at least one use
case. Conversations and multi-step automation are showcased primarily in EdTech
and HR respectively.

---

## Phase 2 notes

### Homepage "What You Can Build" cards

Each use case maps to a card in the Phase 2 homepage section 5 ("What You Can
Build," per the T01 plan). Card-ready content:

| Card title | One-liner |
|------------|-----------|
| Healthcare | Patient agents that triage by your protocols and escalate to physicians when it matters. |
| HR & People | Onboarding agents that guide new hires through every step — policies, access, training — across all your client companies. |
| FinTech | Compliance agents that monitor transactions against each client's regulatory rules and flag what needs human review. |
| Education | Tutoring agents that remember every student's progress and adapt to each course's content and policies. |
| Legal | Contract agents that analyze clauses against your precedent library and pause for attorney review on high-stakes decisions. |

### `/use-cases` page

The full use case entries in this document provide source material for an
expanded `/use-cases` page (T01 plan, Phase 2 additional pages). Each entry
can be expanded with:

- A visual before/after comparison (following the demo story's arc)
- Screenshots or mockups of the agent interaction
- Links to relevant documentation (quickstart, tutorials)

### Adjacent homepage sections

- **Section 4 (How It Works)** covers the three steps: teach, connect, deploy.
- **Section 5 (What You Can Build)** uses these use case cards.
- **Section 6 (Why It Works)** covers the technical trust signals.

The use case cards bridge the "how" and the "why" — they show what the
platform builder ends up with.

---

*This document is a Phase 1 deliverable of the content strategy project. The
use cases, pattern, and coverage matrix are the source material for Phase 2
sales site implementation. No customer-facing copy should contradict the
[positioning document](positioning.md) or the
[vocabulary guide](../../../../docs/vocabulary.md).*
