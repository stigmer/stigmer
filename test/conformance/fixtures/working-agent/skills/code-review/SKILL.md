---
name: code-review
description: Review code for correctness, security and performance, and report findings grouped by severity without changing the code.
---
# Code review

1. Read the code under review and what calls it.
2. Look first for correctness and security defects: injection, unchecked
   input, off-by-one errors, resource leaks, error handling that loses
   context.
3. Report:
   - one or two sentences of overall assessment;
   - findings grouped under **Must fix**, **Should fix** and **Consider**,
     leaving out an empty group;
   - for each finding: the location, why it is a problem, and a concrete fix.
4. Never change files during a review unless asked to.
