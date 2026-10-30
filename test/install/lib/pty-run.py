#!/usr/bin/env python3
"""Run a command on a pseudo-terminal, answer what it shows, and exit with its code.

The install smokes drive a terminal program the way a person does: it sees a
real terminal (stdin and stdout are a TTY, so an Ink app draws live and reads
keys in raw mode), and when its screen shows a prompt, keys are typed. Python's
standard `pty` module does this on Linux and macOS alike, with no native npm
build (test/install/smoke-terminal-kit.mjs, which runs this).

Usage:
  pty-run.py [--answer TEXT=KEYS ...] [--timeout SECONDS] [--log PATH]
             [--cols N] [--rows N] -- COMMAND [ARG ...]

  --answer TEXT=KEYS   when TEXT appears on the screen (ANSI codes stripped),
                       type KEYS, once, in the order the answers are given.
                       KEYS takes \\r, \\n and \\x03 (Ctrl+C) escapes.
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


def parse_answer(spec):
    text, sep, keys = spec.partition("=")
    if not sep or not text:
        raise argparse.ArgumentTypeError(f"an answer is TEXT=KEYS, not {spec!r}")
    return text, codecs.decode(keys, "unicode_escape")


def main(argv):
    parser = argparse.ArgumentParser(prog="pty-run.py")
    parser.add_argument("--answer", action="append", default=[], type=parse_answer)
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
    seen_upto = 0
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
        if answers:
            screen = strip("".join(raw))
            text, keys = answers[0]
            found = screen.find(text, seen_upto)
            if found != -1:
                seen_upto = found + len(text)
                # Let the program mount its key handler after drawing the prompt.
                time.sleep(0.3)
                os.write(master, keys.encode())
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
