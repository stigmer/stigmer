A Skill is a versioned, reusable unit of knowledge and tools that an agent can
use. It contains a SKILL.md file defining the skill's interface and optional
tool executables. Each version is immutably identified by a content hash.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Skill
metadata:
  name: pdf-extractor
  slug: pdf-extractor
spec:
  name: pdf-extractor
  description: "Extracts text and tables from PDF files using OCR when needed"
  tag: stable
  skill_md: |
    ---
    name: pdf-extractor
    description: Extracts text and tables from PDF files using OCR when needed
    ---
    # PDF Extractor
    ...
```
