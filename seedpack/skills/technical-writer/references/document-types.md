# Document Types

Detailed guidance for each document type. Use this reference when you've identified
the document type in Step 1 and need the structural template, tone calibration,
or common mistakes to avoid.

## Tutorial

**Reader's goal:** Learn a skill by completing a guided exercise.

**Tone:** "Follow along with me." You are a patient instructor walking the reader
through something new. Use "we" or "you" — never "the user."

**Structural template:**

1. **What you'll build**: One sentence describing the concrete outcome. The reader
   should be able to picture the finished result. "By the end of this tutorial,
   you'll have a working REST API that authenticates users and returns their profile
   data."

2. **Prerequisites**: List everything the reader needs before starting. Be specific:
   versions, installed tools, accounts. Don't say "basic knowledge of JavaScript" —
   say "familiarity with functions and objects in JavaScript."

3. **Steps**: Numbered, sequential steps that build on each other. Each step should:
   - Start with an action verb ("Create", "Open", "Run", "Add")
   - Include the exact code, command, or action to perform
   - Show the expected result (output, UI change, file created)
   - Explain briefly what happened and why, after the reader has seen it work

4. **What you've learned**: A brief summary (3-5 sentences) reinforcing the key
   concepts the reader just experienced through the exercise.

5. **Next steps**: Point to the logical next document. Motivate it with a gap:
   "Your API works, but it accepts any request. Next, we'll add input validation."

**Common mistakes:**

- Explaining concepts before the reader has experienced them. Tutorials work by
  doing first, explaining second. Don't front-load theory.
- Combining optional variations with required steps. The core tutorial should be a
  straight path. Put variations ("if you're using Windows..." or "alternatively,
  you can...") in callout boxes or a separate section.
- Skipping over prerequisite steps. If the tutorial requires a specific tool version,
  link to the installation instructions rather than assuming the reader has it.
- Testing the tutorial from the wrong starting point. A tutorial should work for
  someone who just finished the prerequisites and has nothing else set up.

## How-to Guide

**Reader's goal:** Accomplish a specific task they already understand conceptually.

**Tone:** "Here is how to do X." Direct, efficient, no hand-holding. The reader
knows what they want — they need the steps.

**Structural template:**

1. **Title**: "How to [verb] [noun]" — e.g., "How to configure CORS headers."

2. **Context** (1-2 sentences): When and why someone would need this. Not a
   concept explanation — just enough to confirm the reader is in the right place.

3. **Prerequisites**: Only prerequisites specific to this task, not general
   product prerequisites the reader would already have.

4. **Steps**: Numbered steps focused on the task. Each step is an action, not
   an explanation. Include code/commands where relevant. Skip the "why" unless
   it affects the reader's decision (e.g., "Use `--force` only if you want to
   overwrite existing data").

5. **Verification** (optional): How the reader confirms the task worked.
   "Run `curl localhost:8080/health` and verify you see `{"status": "ok"}`."

**Common mistakes:**

- Explaining the concept the how-to is about. That belongs in an explanation
  document. Link to it if the reader might need background.
- Covering every edge case inline. Address the most common case in the steps.
  Handle edge cases in a "Troubleshooting" section at the end or in a separate
  how-to.
- Providing multiple paths without recommending one. If there are three ways to
  do something, recommend the best one and mention the others only if they serve
  a distinct use case.

## Explanation

**Reader's goal:** Understand why something works the way it does.

**Tone:** "Here is why this matters." Conversational, thoughtful. You are helping
the reader build a mental model.

**Structural template:**

1. **Opening**: State what this explanation covers and why the reader should care.
   Connect to a problem the reader has encountered or a question they've asked.

2. **Core concept**: Explain the concept, starting from what the reader already
   knows. Use analogies to familiar concepts when they genuinely clarify —
   not as decoration. Build understanding incrementally: simple case first,
   then complications.

3. **Tradeoffs and alternatives**: Why was this approach chosen over others? What
   are the constraints? What would change if different assumptions held? This is
   where explanations add value that tutorials and references cannot.

4. **Connections**: How does this concept relate to other concepts the reader
   already knows? Link to related explanations, tutorials, and references.

**Common mistakes:**

- Including step-by-step instructions. That's a tutorial or a how-to. If the
  reader needs to do something, link to the appropriate guide.
- Explaining without motivation. Opening with "X is a pattern that..." is less
  engaging than "When your application needs to handle 10,000 concurrent
  connections, you need a way to... This is what X solves."
- Using analogies that don't hold up under scrutiny. A bad analogy creates
  misconceptions that are harder to fix than having no analogy at all. Test
  your analogy: does it break if the reader pushes on it?

## Reference

**Reader's goal:** Look up a specific fact quickly.

**Tone:** "Here is the complete specification." Terse, precise, exhaustive.
No narrative, no opinions, no "getting started" framing.

**Structural template:**

1. **Overview** (2-3 sentences): What this reference covers. Not a tutorial
   introduction — just scope.

2. **Organized sections**: Group by logical categories that match how the reader
   would search (by resource type, by operation, by configuration area). Use
   consistent formatting within each section.

3. **For each item** (API method, configuration option, CLI flag):
   - Name/signature
   - Description (one sentence preferred)
   - Parameters/options with types, defaults, and constraints
   - Return value or output
   - Example
   - Caveats or edge cases worth noting

4. **Consistent formatting**: Use tables for parameters and options. Use code
   blocks for examples. Every item in the reference should follow the same
   template so the reader can scan efficiently.

**Common mistakes:**

- Being incomplete. A reference that covers 80% of the API but omits 20% is
  not a reference — it's a partial guide that will send the reader to the
  source code for the rest.
- Adding tutorial-style explanations. If a concept needs explanation, link to
  the explanation document. The reference entry should be self-contained for
  someone who already understands the concept.
- Inconsistent formatting. If method A has a parameters table and method B has
  a bullet list, the reader can't scan. Pick one format and use it everywhere.
- Omitting defaults and edge cases. "Timeout: integer" is incomplete.
  "Timeout: integer, in seconds, default 30, minimum 1, maximum 300" is a
  reference entry.
