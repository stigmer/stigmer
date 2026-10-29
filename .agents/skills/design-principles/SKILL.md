---
name: design-principles
description:
  The maintainer's own words on how Stigmer's screens and text should look, feel
  and read, and what they never do. Use before designing, changing or reviewing
  anything a person sees or reads in a console screen, a terminal frame, the
  React or Ink kit, the theme, the embed, the desktop app or a language
  quickstart.
paths:
  - client-apps/**
  - sdk/react/**
  - sdk/ink/**
  - sdk/theme/**
  - sdk/embed/**
  - sdk/*/README.md
  - test/visual/**
---

# How Stigmer's faces should feel

Stigmer's faces are everything a person sees or reads: the web console, the
`stigmer` CLI and its terminal session, the React and Ink kits a developer
embeds, the desktop app, and the language quickstarts. The UX bar
(`test/ux-bar.json`, `test/README.md`, "The UX bar") holds what a test can prove
about them. This brief holds what no test can: the maintainer's taste.

Every line below is a sentence the maintainer said after looking at the product,
edited only for grammar. Read them before designing a face, and judge a change
against them before asking anyone else to look. A line is added only in the
maintainer's own words, after a look at the product; an agent never writes one
from its own review, because a brief in an agent's words is the machine tone it
exists to keep out.

## How they look and speak

- Serving the purpose is not enough: every screen should give a state-of-the-art
  feeling.
- The session viewer is the face of the product and what we sell; every element
  in it gets special care, and its quality is never compromised.
- A busy task should look busy: while an agent works, the person sees the
  activity.
- Design each face from the person who uses it, then take what fits from the
  references; never start from the reference product.

## What they never do

- A screen should not be mostly empty space.
- Take inspiration, never copy: Stigmer must not look like a clone of another
  product.
