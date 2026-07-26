# LRWA Agent API

Backend for **LRWA — Live Real-World Assurance / 现实验证引擎**. This NestJS
hackathon demo investigates the entirely fictional **晨潮咖啡 Morrow** inside a
deterministic Reality Twin, producing traceable evidence, cross-validated
findings and a human-approved counterfactual replay.

> Synthetic-only boundary: every case, store, probe, event, source and evidence
> item is `SIMULATED`. The demo never impersonates a real person, contacts a
> real company, places a real order, scrapes a real platform, or processes real
> personal data. It is a product demonstration, not evidence about any real
> business.

## Run

```bash
cp .env.example .env
npm install
npm run start:dev
```

The default API is `http://localhost:3001/v1`; `PORT` can override it. No API
key or external service is required.

## Canonical Morrow story

Management reports 48 operating stores, 118 daily orders per store, an average
ticket of ¥19.6 and June GMV of ¥3.33m. Five independent evidence families use
exactly 1,024 parameterized probes. LRWA estimates 39 active stores and June
GMV of ¥1.92m (¥1.72m–¥2.14m), a 42.3% gap at 0.88 confidence.

The Evidence Auditor verifies provenance and hashes, the Statistician computes
the estimates, and the Skeptic challenges the result with an unobserved 20%
corporate-order hypothesis. It cannot rerun autonomously: a human must approve
the replay. The hypothesis raises estimated GMV to ¥2.40m, changes the interval
and gap, but the reported GMV remains `UNSUPPORTED`.

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

# Human approval of the Skeptic's proposed hypothesis:
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

`start` completes synchronously for a reliable live demo. SSE replays the
complete ordered event ledger, including `HYPOTHESIS_RAISED` on the initial run
and `REPLAY_STARTED` only after human approval.

## API

| Method | Endpoint | Response |
| --- | --- | --- |
| `GET` | `/v1` | Health and simulation mode |
| `POST` | `/v1/demo/cases` | `{ case, investigation }` |
| `GET` | `/v1/cases/:caseId` | `DemoCase`, including 48 synthetic map stores |
| `POST` | `/v1/investigations/:id/plan` | Plan with 5 tasks / 1,024 probes |
| `POST` | `/v1/investigations/:id/approve` | Approved investigation |
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
  supply-chain signals are independent evidence families.
- High confidence requires at least two independent evidence families.
- The same seed and same hypothesis produce identical measurements, findings
  and replay identity.
- The replay request is validated, recorded on the investigation, and emitted
  in auditable SSE events.

## Verify

```bash
npm run format:check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Tests cover the canonical values, 48 map stores, exactly 1,024 probes, seeded
reproducibility, evidence hash traceability, the confidence gate, REST state
transitions, SSE, hypothesis validation and changed replay results.

## Container deployment

```bash
docker build -t lrwa-agent .
docker run --rm -p 3001:3001 -e PORT=3001 lrwa-agent
```

`render.yaml` provides a Docker-based Render web-service blueprint. The server
always binds the platform-provided `PORT`.
