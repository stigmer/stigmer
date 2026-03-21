# Reminder: Developer Marketing Principles

These principles govern how Stigmer communicates with developer audiences on the sales website. Developers are a unique audience — they are technically literate, naturally skeptical, and deeply allergic to hype. The playbooks that work for enterprise SaaS or consumer products will actively harm Stigmer's credibility.

## The Rules

### Show, Don't Tell

- Code examples, terminal output, and architecture diagrams are more persuasive than adjectives.
- A working `brew install stigmer/tap/stigmer` command is worth more than a paragraph about "seamless installation."
- Every claim must be accompanied by proof. "Agents survive crashes" → show a terminal output of an execution resuming after failure. "5 lines of YAML" → show the actual 5 lines.
- If you cannot show it, do not claim it.

### Honesty Builds Trust

- State what Stigmer does well and be transparent about where it is headed.
- Developers respect transparency about limitations more than false completeness claims.
- "Early stage, moving fast" is credible. "Enterprise-ready, battle-tested" (when it is not) is destructive.
- Admit tradeoffs. "Stigmer adds a runtime dependency in exchange for durable execution, checkpoint recovery, and lifecycle management" is honest. "Zero overhead" is suspicious.

### Technical Depth Is a Marketing Asset

- Developers want to understand how things work before they adopt. They do not trust black boxes.
- Architecture diagrams, design decisions, and "how it works under the hood" content are marketing assets, not just documentation. Put them on the sales website, not only in the docs.
- "Powered by Temporal" is more credible than "durable execution engine." Name the technologies. Developers will look them up — and finding recognized, respected tools builds trust.

### Open Source Is the Trust Signal

- Apache 2.0, public repo, visible commits, real contributors — these are Stigmer's strongest credibility markers.
- Lead with the license. Developers check the license before they check the features.
- Show the GitHub activity: stars, forks, recent commits, contributor count. Stale repos signal abandoned projects.
- The open-core model must be communicated clearly: what is OSS, what is Cloud, and where the boundary is. Ambiguity about licensing destroys trust faster than anything else.

### Comparison Is Expected

- Developers evaluate alternatives. Pretending alternatives do not exist makes Stigmer look either naive or dishonest.
- Provide honest comparison content: when Stigmer is the right choice, when it is not, and what the genuine technical differences are.
- "Use LangChain directly if you want maximum framework flexibility and do not need infrastructure. Use Stigmer if you want declarative configuration, durable execution, and multi-tenant support out of the box." This is honest positioning.
- Never misrepresent competitors. Developers who know those tools will notice, and Stigmer's credibility will suffer.

### The README Is Marketing

- The GitHub README is often the first thing a developer reads — before the website, before the docs.
- It must be as carefully crafted as the homepage: clear positioning, working code example, install command, link to docs.
- Keep the README and the homepage consistent. If the messaging diverges, developers who see both will question which one is accurate.

### Community Signals Matter

- GitHub stars, contributor activity, Discord/community engagement, and real usage examples are the developer equivalent of customer testimonials.
- Show real metrics, not vanity metrics. "Used by X developers" must be verifiable. "Loved by thousands" is marketing noise.
- Contributor activity signals project health. A repo with 100 stars and daily commits is more credible than one with 10,000 stars and no commits in 6 months.

### Respect the Visitor's Time

- Developers are busy. They evaluate dozens of tools. Stigmer gets one chance.
- **Get to the point.** Lead with what it does, show how it works, let them try it.
- Do not make them scroll through three screens of animations before seeing a code example.
- Do not gate content behind signup forms. Developers will leave rather than fill out a form to see a demo.
- The install command and quickstart path must be visible within the first two viewports. If they want to try it, do not make them hunt.

## Banned Patterns

These patterns are common in SaaS marketing and actively harmful for developer audiences:

- **Vague superlatives:** "powerful," "seamless," "best-in-class," "next-generation," "revolutionary"
- **Unattributed testimonials:** "Developers love Stigmer" without a name, company, or link
- **Stock imagery:** Photos of people typing, abstract gradients with no information content
- **Feature walls:** Lists of 20+ features with no hierarchy, no benefits, no proof
- **Gated content:** Requiring email signup to access demos, examples, or technical content
- **Fake urgency:** "Limited time," "Act now," countdown timers
- **Enterprise jargon:** "Digital transformation," "synergy," "leverage," "scalable solutions"

## Before Publishing Any Marketing Content

Check each item:

- [ ] Every claim is specific and verifiable
- [ ] Code examples are real, runnable, and minimal
- [ ] The tone sounds like an engineer, not a marketer
- [ ] Competitive comparisons are fair and honest
- [ ] The open source license is visible and clear
- [ ] The visitor can reach a working install command within 2 scrolls
- [ ] No banned patterns (vague superlatives, stock imagery, gated content)
- [ ] Performance is tested (Core Web Vitals pass)
- [ ] Content works on mobile without horizontal scrolling or truncated code
