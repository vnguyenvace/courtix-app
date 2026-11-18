#!/usr/bin/env bash
# Checks psql output from one SQL test file.
#
#   ./scripts/check-test-output.sh <test.sql> <psql-output>
#
# Rules (see CLAUDE.md):
# - A statement that should fail has  \echo 'expect: ...'  on the line directly before it.
# - Every ERROR must come from such a statement.
# - Every "expect:" statement must actually fail (otherwise a rule isn't being enforced).
# - FATAL / PANIC anywhere fails the test.
set -uo pipefail
test_file="$1"
output="$2"

awk -v testfile="$test_file" '
  # Pass 1: the test file. Remember expect lines and which lines end a statement.
  FNR == NR {
    line = $0
    if (line ~ /^[[:space:]]*\\echo[[:space:]]+.expect:/) expect[FNR] = 1
    stripped = line
    sub(/--.*$/, "", stripped)
    sub(/[[:space:]]+$/, "", stripped)
    if (stripped ~ /;$/ || stripped ~ /\\g(set|exec)?([[:space:]]|$)/) ends[FNR] = 1
    next
  }
  # Pass 2: psql output.
  /(FATAL|PANIC):/ { print "  unexpected: " $0; bad++; next }
  /ERROR:/ {
    if (match($0, /^psql:[^:]*:[0-9]+:/)) {
      hdr = substr($0, RSTART, RLENGTH - 1)
      n = split(hdr, parts, ":"); errline = parts[n] + 0
      # Walk back from the line before the error to the nearest expect line,
      # failing if another statement ends in between.
      ok = 0
      for (l = errline - 1; l > 0; l--) {
        if (l in expect) { ok = 1; break }
        if (l in ends) break
      }
      if (ok) { matched[l] = 1; next }
      print "  unexpected (" testfile ":" errline "): " $0
    } else {
      print "  unexpected: " $0
    }
    bad++
  }
  END {
    for (l in expect) if (!(l in matched)) {
      print "  expected an error but the statement succeeded (" testfile ":" l ")"
      bad++
    }
    exit bad > 0 ? 1 : 0
  }
' "$test_file" "$output"
