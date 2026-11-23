# Dhan Khata (ধান খাতা)

An offline-first, bilingual (বাংলা / English) business app for paddy brokers in West Bengal. Each godown keeps its own independent set of books.

- The full specification is in [`requirement.md`](requirement.md).
- Build progress is tracked in [`docs/PROGRESS.md`](docs/PROGRESS.md), and each phase is described in [`docs/phases/`](docs/phases/).
- Rules for AI-assisted development are in [`CLAUDE.md`](CLAUDE.md).

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm typecheck
pnpm lint
pnpm check:no-float # no floating-point math in src/domain
pnpm test           # unit + property tests (Vitest, fast-check)
pnpm build
```

Requires Node 24 and pnpm 10.
