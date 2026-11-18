#!/bin/sh
set -e
# The bank's runner puts stigmer-bank-fixture on PATH: before every try it puts back
# whatever an earlier try deleted or changed in the fixture this case reads, and puts
# the fixture agents' manifests in this folder as stigmer/<agent>.yaml, as a person
# who set up holds them.
if command -v stigmer-bank-fixture >/dev/null 2>&1; then stigmer-bank-fixture; fi
