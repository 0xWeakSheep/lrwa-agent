# LRWA Agent API

Backend for **LRWA — Live Real-World Assurance / 现实验证引擎**. This NestJS
hackathon demo investigates the entirely fictional **晨潮咖啡 Morrow** inside a
deterministic Reality Twin, producing traceable evidence, cross-validated
findings and a caller-gated counterfactual replay.

> Synthetic-only boundary: every case, store, probe, event, source and evidence
> item is `SIMULATED`. The demo never impersonates a real person, contacts a
> real company, places a real order, scrapes a real platform, or processes real
> personal data. It is a product demonstration, not evidence about any real
> business.

## OpenArena reviewer links

- Public product demo:
  https://lrwa-agent-web.cheeky-angel-7701.chatgpt.site
- 90-second demo film:
  https://raw.githubusercontent.com/0xWeakSheep/lrwa-agent-web/main/public/materials/LRWA_OpenArena_Demo_90s.mp4
- Public pitch deck:
  https://raw.githubusercontent.com/0xWeakSheep/lrwa-agent-web/main/public/materials/LRWA_Seed_Deck.pdf
- Next.js frontend:
  https://github.com/0xWeakSheep/lrwa-agent-web

## Run

```bash
cp .env.example .env
npm install
npm run start:dev
```

The default API is `http://localhost:3001/v1`; `PORT` can override it. No API
key or external service is required.

For the exact demo formulas, heuristic policy score, replay behavior,
limitations, and production calibration path, see
[METHODOLOGY.md](./METHODOLOGY.md).

## DeepSeek language layer

DeepSeek optionally powers three bounded language tasks:

- `PLAN`: explains the five-category plan and its declared aggregate quota of
  1,024.
- `CHALLENGE`: helps the Skeptic articulate the fixed 20% corporate-order
  counter-hypothesis.
- `EXPLANATION`: explains deterministic findings and next actions.

It never generates evidence, measurements, hashes, fixed scenario bands,
heuristic policy scores, verdicts or replay parameters. Those remain in the
seeded deterministic pipeline. If `DEEPSEEK_API_KEY` is absent, times out,
returns invalid JSON, is rate-limited or has an upstream failure, the same API
flow completes with deterministic local language. HTTP 429 and 5xx responses
receive one short retry.

The demo requests non-thinking JSON mode with a 512-token ceiling so the live
language layer stays fast and bounded.

Configuration:

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

The key is read only from the process environment. It is never included in
responses, events, prompts, logs or repository files. Provenance exposes only
provider, model, operation, attempts and `LIVE` or `DETERMINISTIC_FALLBACK`
mode. The default is `deepseek-v4-flash`; the deprecated legacy
`deepseek-chat` name is not used.

## Canonical Morrow story

Management reports 48 operating stores, 118 daily orders per store, an average
ticket of ¥19.6 and June GMV of ¥3.33m. Five logical evidence families
represent a fixed aggregate quota of 1,024 parameterized probes. The demo
generates five aggregate evidence receipts, not 1,024 stored raw observations.
LRWA estimates 39 active stores and June GMV of ¥1.92m within a fixed
¥1.72m–¥2.14m scenario band, a 42.3% gap at a 0.88 heuristic policy score.

The Evidence Auditor verifies provenance and hashes, the Statistician computes
the estimates, and the Skeptic challenges the result with an unobserved 20%
corporate-order hypothesis. It cannot rerun autonomously: a separate
unauthenticated UI/API interaction starts the deterministic replay. Production
would require identity-verified approval. The hypothesis raises estimated GMV
to ¥2.40m, changes the fixed scenario band and gap, but the reported GMV
remains `UNSUPPORTED`.

## Synthetic Agent Executor

The demo now executes each of the five plan tasks separately through a
`SyntheticAgentExecutorService`. For every task, the executor resolves the
assigned specialist, checks that the requested tool appears in that role's
allowlist, requires declared guardrails, enforces the `SIMULATED_ONLY`
boundary, invokes the matching deterministic adapter, and validates the
returned family, agent, tool, sample allocation and SHA-256 receipt hash.

The event ledger records `AGENT_DISPATCHED`, `TOOL_POLICY_CHECKED`,
`EVIDENCE_CAPTURED`, and `AGENT_TASK_COMPLETED` for each task. This is a real
task-level orchestration path with tool-allowlist, declared-guardrail, and
synthetic-boundary checks over deterministic adapters; it is not a claim that
the guardrail text was independently enforced, or that five independent
real-world agents or 1,024 live observations ran.

## Exact curl flow

`jq` is used only to extract IDs:

```bash
demo_json=$(curl -sS -X POST http://localhost:3001/v1/demo/cases \
  -H 'content-type: application/json' \
  -d '{"seed":"morrow-demo-2026"}')
investigation_id=$(printf '%s' "$demo_json" | jq -r '.investigation.id')

curl -sS -X POST \
  "http://localhost:3001/v1/investigations/$investigation_id/plan"
curl -sS -X POST \
  "http://localhost:3001/v1/investigations/$investigation_id/approve"
curl -sS -X POST \
  "http://localhost:3001/v1/investigations/$investigation_id/start"

curl -sS \
  "http://localhost:3001/v1/investigations/$investigation_id/evidence"
curl -sS \
  "http://localhost:3001/v1/investigations/$investigation_id/findings"
curl -N \
  "http://localhost:3001/v1/investigations/$investigation_id/events"

# Explicit demo interaction for the Skeptic's proposed hypothesis:
replay_json=$(curl -sS -X POST \
  "http://localhost:3001/v1/investigations/$investigation_id/replay" \
  -H 'content-type: application/json' \
  -d '{"corporateOrderShare":0.2}')
replay_id=$(printf '%s' "$replay_json" | jq -r '.id')

curl -sS \
  "http://localhost:3001/v1/investigations/$replay_id/findings"
curl -N \
  "http://localhost:3001/v1/investigations/$replay_id/events"
```

The supervisor state machine is:

```text
DRAFT -> PLANNED -> APPROVED -> RUNNING -> COMPLETED
```

`APPROVED` is an internal workflow state name, not proof of identity or a
compliance-grade approval. `start` completes synchronously for a reliable live
demo. SSE replays the complete ordered event ledger, including
`HYPOTHESIS_RAISED` on the initial run and `REPLAY_STARTED` only after the
separate caller interaction.

## API

| Method | Endpoint | Response |
| --- | --- | --- |
| `GET` | `/v1` | Health and simulation mode |
| `POST` | `/v1/demo/cases` | `{ case, investigation }` |
| `GET` | `/v1/cases/:caseId` | `DemoCase`, including 48 synthetic map stores |
| `POST` | `/v1/investigations/:id/plan` | Plan with 5 tasks and a declared aggregate quota of 1,024 |
| `POST` | `/v1/investigations/:id/approve` | Records the demo interaction gate and moves to `APPROVED` |
| `POST` | `/v1/investigations/:id/start` | Completed initial investigation |
| `POST` | `/v1/investigations/:id/replay` | Body `{ corporateOrderShare: 0..0.5 }` |
| `GET` | `/v1/investigations/:id` | Investigation and hypothesis audit |
| `GET` | `/v1/investigations/:id/evidence` | `Evidence[]`, including store signals |
| `GET` | `/v1/investigations/:id/findings` | `Finding[]` with bounds and actions |
| `GET` | `/v1/investigations/:id/events` | Server-sent event ledger |

Invalid request bodies return `400`, invalid state transitions return `409`,
and unknown entities return `404`.

## Evidence and reproducibility policy

- Every evidence item records `SIMULATED`, source family and methodology,
  agent, tool, sample size and SHA-256 content hash.
- Store observation, synthetic consumer panel, digital footprint, labor and
  supply-chain signals are different logical evidence families; statistical
  independence is not claimed.
- The demo's `HIGH` policy band requires at least two logical evidence
  families.
- The same seed and same hypothesis produce identical measurements, findings
  and replay identity.
- The replay request is validated, recorded on the investigation, and emitted
  in auditable SSE events.
- `investigation.llmRuns`, `agentInsights.*.provenance` and
  `LLM_LAYER_USED` events identify the language provider, model and mode without
  exposing prompts or secrets.

## Verify

```bash
npm run format:check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Tests cover the canonical values, 48 map stores, the declared aggregate quota
of 1,024, five aggregate receipts, task-level tool policy enforcement, blocked
unauthorized tools, seeded reproducibility, evidence hash traceability, the
heuristic policy gate, REST state transitions, SSE, hypothesis validation,
changed replay results, no-key fallback, live JSON parsing, provenance and
retry behavior.

## Container deployment

```bash
docker build -t lrwa-agent .
docker run --rm -p 3001:3001 -e PORT=3001 lrwa-agent
```

`render.yaml` provides a Docker-based Render web-service blueprint. The server
always binds the platform-provided `PORT`.
