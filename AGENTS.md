# TypeDuel — Codex Repository Instructions

## Priorities
1. Read `docs/PRD.md`, `docs/SYSTEM_DESIGN.md`, `docs/UI_UX_DESIGN.md`, and `docs/IMPLEMENTATION_PLAN.md` before designing or changing gameplay.
2. Build one milestone at a time; present a plan before changes that alter architecture or data contracts.
3. Keep the dark charcoal + teal design consistent with `docs/design/tokens.json` and reference PNGs.
4. Never put canonical answer words, answer lookup IDs, provider secrets, or privileged assets in the mobile bundle.
5. The server owns match phase, word selection, correctness, deadlines, attempts, scoring, difficulty transitions and results.
6. Follow approved V1 rules: three distinct attempts, two extra replays, up to three sudden-death rounds, Classic/Challenge and categories as defined in PRD.
7. Use TypeScript strictness, Zod schemas, tests and migrations; protect idempotency and duplicate event handling.
8. Check iOS and Android native keyboard layouts, safe areas, readability and accessibility before claiming design completion.
9. Never deploy to production, incur costs, create cloud resources, publish to stores, rewrite Git history or destructively migrate user data without express approval.
10. At the end of each task: list files changed, tests run, unresolved risks and next small recommended task.

## Definition of done
- Lint/typecheck/related tests pass.
- Product and architecture rules have not silently changed.
- No real secrets, secret answers or fabricated production data.
- Screens match approved visual hierarchy and are responsive to native keyboard changes.
- Documentation and screenshots updated when intended behavior changes.
