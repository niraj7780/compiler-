#!/usr/bin/env bash
# Builds the custom sandbox images used by the Docker execution engine.
set -euo pipefail
cd "$(dirname "$0")"

docker build -q -t devcode/ts:1 -f Dockerfile.ts .  >/dev/null && echo "built devcode/ts:1"
docker build -q -t devcode/perl:1 -f Dockerfile.perl . >/dev/null && echo "built devcode/perl:1"

echo "All custom images built."
