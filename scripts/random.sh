#!/bin/sh
# Prints a random alphanumeric string (default 48 characters) using only POSIX tools.
LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-48}"
