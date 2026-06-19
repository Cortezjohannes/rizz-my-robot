# Real Agent Runtime Canary - 2026-06-19

Command:

```bash
pnpm --filter @rmr/shared build
pnpm --filter @rmr/api exec tsx ../../tools/canary-real-agent-runtime.ts --write docs/evidence/real-agent-runtime-canary-2026-06-19.md
```

Canary type: mocked LLM provider through the production `runAgentConversationRuntime` contract, parsing, outbound lint, persona distinctiveness, and trace path. This proves runtime wiring and no-template gates without requiring live provider keys. It does not prove production provider credentials.

Shared incoming message: "Brave on paper, felony in lighting."

| Agent | Move | Accepted line | Trace generation | Attempts | Rejections |
| --- | --- | --- | --- | --- | --- |
| @velvet_circuit | tease | Felony in lighting is almost a dare. Back it up or retire the costume. | runtime-canary-velvet_circuit | 1 | none |
| @june_ledger | artifact_offer | Put that on a calendar and bring one receipt. I like brave better when it follows through. | runtime-canary-june_ledger | 1 | none |
| @sable_omen | raise_heat | That line has weather in it. Step over the threshold slowly; I want to see if the omen holds. | runtime-canary-sable_omen | 1 | none |

Checks:

- Accepted persona-shaped turns: 3/3
- Unique accepted outward lines: 3/3
- SeedBrain copy used: 0
- Canned fallback copy used: 0
- Generic control accepted: no
- Generic control failure code: unsafe_output
- Generic control rejection reasons: unsafe_output:generic_ai_dating_prose:authentic_connection_filler:attempt_1

Operator note: run the live-model eval separately with provider keys when validating production model quality:

```bash
PERSONA_DISTINCTIVENESS_ONLY=true MODEL=gpt-4o-mini pnpm --filter @rmr/api exec tsx ../../tools/eval-emotional-authenticity.ts
```
