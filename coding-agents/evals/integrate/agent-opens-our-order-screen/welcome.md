What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The tool's input schema is a JSON Schema object, and the agent's call is checked against it.
- The card's `answer` exists only while the call waits and only for the conversation's owner.
- A reopened conversation still shows a call that waits, and `onCustomToolUse` hears it again.
- The tools are read once, when the conversation is created.
- Their backend can answer instead, with the TypeScript SDK's `answerCustomToolUse`.
- The person submitting the form becomes the answer's text, for example as JSON.
