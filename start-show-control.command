#!/bin/sh
# Start Whatnot Show Control (macOS / Linux). Ctrl+C to stop.
cd "$(dirname "$0")"
node server/index.js
