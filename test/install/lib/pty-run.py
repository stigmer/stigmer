#!/usr/bin/env python3
"""Run a command on a pseudo-terminal, answer what it shows, and exit with its code.

The install smokes drive a terminal program the way a person does: it sees a
real terminal (stdin and stdout are a TTY, so an Ink app draws live and reads
keys in raw mode), and when its screen shows a prompt, keys are typed. Python's
standard `pty` module does this on Linux and macOS alike, with no native npm
build (test/install/smoke-terminal-kit.mjs, which runs this).

Usage:
  pty-run.py [--answer TEXT=KEYS ...] [--resize COLSxROWS@TEXT ...]
             [--timeout SECONDS] [--log PATH] [--cols N] [--rows N] -- COMMAND [ARG ...]

  --answer TEXT=KEYS   when TEXT appears on the screen (ANSI codes stripped),
                       type KEYS, once, in the order the answers are given.
                       KEYS takes \\r, \\n and \\x03 (Ctrl+C) escapes, and named
                       keys, each typed on its own as a person presses it:
                       <enter> <esc> <up> <down> <left> <right> <tab>
                       <shift-tab> <ctrl-c> <ctrl-j> <ctrl-u> <backspace>, and
                       <paste:TEXT>, a bracketed paste of TEXT (escapes taken).
  --resize COLSxROWS@TEXT
                       when TEXT appears, set the window to COLS by ROWS and
                       tell the command (SIGWINCH), once, in order.
  --timeout SECONDS    kill the command and exit 124 after this long (default 300).
  --log PATH           write everything the command drew there, raw.

The command's screen, ANSI codes stripped, is printed to stdout when it
exits; the exit code is the command's (128 + N when signal N ended it), 124
on the timeout, and 125 when an answer's text never appeared.

Proven by test/install/lib/pty-run.test.mjs.
"""

import argparse
import codecs
import fcntl
import os
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")


def strip(text):
    """The screen's text without escape sequences or carriage returns."""
    return ANSI.sub("", text).replace("\r", "")


NAMED_KEYS = {
    "enter": "\r",
    "esc": "\x1b",
    "up": "\x1b[A",
    "down": "\x1b[B",
    "right": "\x1b[C",
    "left": "\x1b[D",
    "tab": "\t",
    "shift-tab": "\x1b[Z",
    "ctrl-c": "\x03",
    "ctrl-j": "\n",
    "ctrl-u": "\x15",
    "backspace": "\x7f",
}
KEY_TOKEN = re.compile(r"<(paste:[^>]*|[a-z-]+)>")


def key_chunks(keys):
    """KEYS as the writes a person's keyboard makes: text as one, each named key on its own."""
    chunks = []
    at = 0
    for match in KEY_TOKEN.finditer(keys):
        name = match.group(1)
        if not name.startswith("paste:") and name not in NAMED_KEYS:
            continue
        if match.start() > at:
            chunks.append(codecs.decode(keys[at:match.start()], "unicode_escape"))
        if name.startswith("paste:"):
            chunks.append("\x1b[200~" + codecs.decode(name[len("paste:"):], "unicode_escape") + "\x1b[201~")
        else:
            chunks.append(NAMED_KEYS[name])
        at = match.end()
    if at < len(keys):
        chunks.append(codecs.decode(keys[at:], "unicode_escape"))
    return chunks


def parse_answer(spec):
    text, sep, keys = spec.partition("=")
    if not sep or not text:
        raise argparse.ArgumentTypeError(f"an answer is TEXT=KEYS, not {spec!r}")
    return text, key_chunks(keys)


def parse_resize(spec):
    size, sep, text = spec.partition("@")
    match = re.fullmatch(r"(\d+)x(\d+)", size)
    if not sep or not text or match is None:
        raise argparse.ArgumentTypeError(f"a resize is COLSxROWS@TEXT, not {spec!r}")
    return text, int(match.group(1)), int(match.group(2))


def main(argv):
    parser = argparse.ArgumentParser(prog="pty-run.py")
    parser.add_argument("--answer", action="append", default=[], type=parse_answer)
    parser.add_argument("--resize", action="append", default=[], type=parse_resize)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--log")
    parser.add_argument("--cols", type=int, default=120)
    parser.add_argument("--rows", type=int, default=40)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a command to run is required after --")

    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))

    def make_controlling_terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    child = subprocess.Popen(
        command, stdin=slave, stdout=slave, stderr=slave, preexec_fn=make_controlling_terminal, close_fds=True
    )
    os.close(slave)

    raw = []
    answers = list(args.answer)
    resizes = list(args.resize)
    seen_upto = 0
    resized_upto = 0
    deadline = time.monotonic() + args.timeout
    timed_out = False
    while True:
        if time.monotonic() > deadline:
            timed_out = True
            os.killpg(child.pid, signal.SIGKILL)
            break
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            raw.append(chunk.decode("utf-8", "replace"))
        elif child.poll() is not None:
            # The child is gone; drain what it left and stop.
            try:
                while select.select([master], [], [], 0.05)[0]:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        break
                    raw.append(chunk.decode("utf-8", "replace"))
            except OSError:
                pass
            break
        if resizes:
            screen = strip("".join(raw))
            text, cols, rows = resizes[0]
            found = screen.find(text, resized_upto)
            if found != -1:
                resized_upto = found + len(text)
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                try:
                    os.killpg(child.pid, signal.SIGWINCH)
                except ProcessLookupError:
                    pass
                resizes.pop(0)
        if answers:
            screen = strip("".join(raw))
            text, chunks = answers[0]
            found = screen.find(text, seen_upto)
            if found != -1:
                seen_upto = found + len(text)
                # Let the program mount its key handler after drawing the prompt.
                time.sleep(0.3)
                for index, chunk in enumerate(chunks):
                    if index > 0:
                        # Apart, as keys are pressed: a terminal app reads one
                        # write with several escape sequences as one key.
                        time.sleep(0.15)
                    os.write(master, chunk.encode())
                answers.pop(0)

    code = child.wait()
    os.close(master)
    output = "".join(raw)
    if args.log:
        with open(args.log, "w", encoding="utf-8") as log:
            log.write(output)
    sys.stdout.write(strip(output))
    sys.stdout.flush()
    if timed_out:
        return 124
    if answers:
        sys.stderr.write(f"pty-run: never saw {answers[0][0]!r}\n")
        return 125
    return 128 - code if code < 0 else code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
