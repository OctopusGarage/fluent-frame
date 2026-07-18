#!/bin/sh
set -eu

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit
