# Clarity Checklist

Use this checklist during the self-review step to evaluate writing quality.
Each item is a specific test — not a vague principle. Read the document
paragraph by paragraph and check each applicable item.

## Sentence Level

- [ ] Every sentence has one idea. If a sentence has two clauses joined by
      "and" or "but" that could stand alone, split it.
- [ ] Active voice is used for all instructions and descriptions. Passive voice
      ("is returned", "was created") is acceptable only in error descriptions
      where the agent is unknown ("the connection was refused").
- [ ] No filler phrases: "It is important to note that", "Basically",
      "In order to" (use "To"), "As mentioned above", "It should be noted."
      If the sentence works without the phrase, remove it.
- [ ] Technical terms are used precisely. "Parameter" and "argument" are not
      interchangeable. "Authentication" and "authorization" are different.
      Use the correct term for what you mean.
- [ ] Numbers and quantities are specific. Replace "several", "a few", "some
      time" with actual values or ranges where possible.

## Paragraph Level

- [ ] No paragraph exceeds 4-5 sentences. Break longer paragraphs at the
      natural thought boundary.
- [ ] The first sentence of each paragraph carries the key point. A reader
      who reads only first sentences should get the gist of the document.
- [ ] Paragraphs do not mix instructions with explanations. If a paragraph
      tells the reader to do something and then explains a concept, split
      the instruction from the explanation.

## Structure Level

- [ ] Headings are specific and scannable. "Configuration" is vague.
      "Configure database credentials" tells the reader exactly what this
      section covers.
- [ ] The heading hierarchy is logical. H2 sections don't appear under H4.
      Subsections are genuine subdivisions of their parent, not unrelated
      topics at a lower heading level.
- [ ] Lists are used for three or more parallel items. Sequences of steps
      are numbered lists, not embedded in a paragraph.
- [ ] Code blocks include the language identifier for syntax highlighting.

## Code Examples

- [ ] Every code example is syntactically correct and would execute as written
      (or is clearly marked as pseudocode with `# pseudocode` or similar).
- [ ] Code examples show the complete, runnable version — not a fragment that
      requires the reader to guess the imports, setup, or surrounding code.
      If showing a fragment for brevity, indicate what is omitted.
- [ ] Output examples match what the code actually produces. If output depends
      on data or state, use representative values and note the dependency.
- [ ] Placeholders are visually distinct and described. Use `<your-api-key>`
      with angle brackets, not `YOUR_API_KEY` which looks like a constant.
      Describe what the reader should substitute: "Replace `<your-api-key>`
      with the key from your dashboard settings page."
- [ ] No hardcoded values that the reader must change without being told.
      If an example uses `localhost:8080`, note that the reader should
      substitute their own host and port.

## Accuracy

- [ ] Every API endpoint, method name, CLI flag, and configuration option
      matches the current version of the software. If writing for a specific
      version, state it.
- [ ] Default values are stated explicitly wherever relevant. "The timeout
      defaults to 30 seconds" is necessary; "there is a timeout" is not
      enough.
- [ ] Required vs. optional parameters are distinguished. The reader must
      know which parameters they can omit.
- [ ] Destructive or irreversible operations are called out explicitly.
      "This command deletes all data in the database" should be impossible
      to miss.

## Audience Appropriateness

- [ ] Vocabulary matches the target audience. End-user docs don't use internal
      jargon. Developer docs don't over-explain standard concepts.
- [ ] Background assumptions are calibrated. A tutorial for beginners doesn't
      assume knowledge of advanced features. A reference for experienced
      developers doesn't explain what an API is.
- [ ] The level of detail is right. Too much detail buries the signal. Too
      little leaves the reader guessing. For each section, ask: "Does the
      target reader need this information to accomplish their goal?"
