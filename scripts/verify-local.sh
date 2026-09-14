#!/bin/sh
set -eu

pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm audit
