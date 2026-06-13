// Faithful port of Go's path/filepath Match, used by the gitignore pattern
// engine to match a single glob against a single path component.
//
// The separator is fixed to "/" (paths are normalized to forward slashes and
// individual components never contain a separator). Matching operates on UTF-16
// code units rather than runes — correct for the ASCII glob syntax gitignore
// patterns use; exotic multi-byte classes are out of scope.
//
// Go returns ErrBadPattern for malformed patterns; every go-git caller treats
// that as "no match", so `matchName` swallows the error and returns false.

const SEPARATOR = "/";

class BadPatternError extends Error {}

/** Match `name` against the glob `pattern` (Go filepath.Match semantics). */
export function matchName(pattern: string, name: string): boolean {
  try {
    return matchImpl(pattern, name);
  } catch (err) {
    if (err instanceof BadPatternError) return false;
    throw err;
  }
}

function matchImpl(pattern: string, name: string): boolean {
  outer: while (pattern.length > 0) {
    const [star, chunk, rest] = scanChunk(pattern);
    pattern = rest;

    if (star && chunk === "") {
      // Trailing `*` matches the rest of the component (which has no separator).
      return !name.includes(SEPARATOR);
    }

    const [t, ok] = matchChunk(chunk, name);
    if (ok && (t.length === 0 || pattern.length > 0)) {
      name = t;
      continue;
    }

    if (star) {
      for (let i = 0; i < name.length && name[i] !== SEPARATOR; i++) {
        const [t2, ok2] = matchChunk(chunk, name.slice(i + 1));
        if (ok2) {
          if (pattern.length === 0 && t2.length > 0) continue;
          name = t2;
          continue outer;
        }
      }
    }
    return false;
  }
  return name.length === 0;
}

function scanChunk(pattern: string): [boolean, string, string] {
  let star = false;
  while (pattern.length > 0 && pattern[0] === "*") {
    pattern = pattern.slice(1);
    star = true;
  }

  let inrange = false;
  let i = 0;
  scan: for (i = 0; i < pattern.length; i++) {
    switch (pattern[i]) {
      case "\\":
        if (i + 1 < pattern.length) i++;
        break;
      case "[":
        inrange = true;
        break;
      case "]":
        inrange = false;
        break;
      case "*":
        if (!inrange) break scan;
        break;
    }
  }
  return [star, pattern.slice(0, i), pattern.slice(i)];
}

function matchChunk(chunk: string, s: string): [string, boolean] {
  let failed = false;
  while (chunk.length > 0) {
    if (!failed && s.length === 0) failed = true;

    const c = chunk[0];
    if (c === "[") {
      let r = "";
      if (!failed) {
        r = s[0];
        s = s.slice(1);
      }
      chunk = chunk.slice(1);
      let negated = false;
      if (chunk.length > 0 && chunk[0] === "^") {
        negated = true;
        chunk = chunk.slice(1);
      }
      let match = false;
      let nrange = 0;
      for (;;) {
        if (chunk.length > 0 && chunk[0] === "]" && nrange > 0) {
          chunk = chunk.slice(1);
          break;
        }
        let lo: string;
        [lo, chunk] = getEsc(chunk);
        let hi = lo;
        if (chunk[0] === "-") {
          [hi, chunk] = getEsc(chunk.slice(1));
        }
        if (lo <= r && r <= hi) match = true;
        nrange++;
      }
      if (match === negated) failed = true;
    } else if (c === "?") {
      if (!failed) {
        if (s[0] === SEPARATOR) failed = true;
        s = s.slice(1);
      }
      chunk = chunk.slice(1);
    } else if (c === "\\") {
      chunk = chunk.slice(1);
      if (chunk.length === 0) throw new BadPatternError("bad pattern");
      if (!failed) {
        if (chunk[0] !== s[0]) failed = true;
        s = s.slice(1);
      }
      chunk = chunk.slice(1);
    } else {
      if (!failed) {
        if (chunk[0] !== s[0]) failed = true;
        s = s.slice(1);
      }
      chunk = chunk.slice(1);
    }
  }
  if (failed) return ["", false];
  return [s, true];
}

function getEsc(chunk: string): [string, string] {
  if (chunk.length === 0 || chunk[0] === "-" || chunk[0] === "]") {
    throw new BadPatternError("bad pattern");
  }
  if (chunk[0] === "\\") {
    chunk = chunk.slice(1);
    if (chunk.length === 0) throw new BadPatternError("bad pattern");
  }
  const r = chunk[0];
  const nchunk = chunk.slice(1);
  if (nchunk.length === 0) throw new BadPatternError("bad pattern");
  return [r, nchunk];
}
