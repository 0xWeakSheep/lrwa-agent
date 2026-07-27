# LRWA Agent API

NestJS backend for **LRWA, Live Real-World Assurance**. The primary API turns
one commercial claim into a staged evidence mission without manufacturing
contacts, receipts, business metrics, or conclusions.

## What the primary API does

1. Accepts a subject, falsifiable claim, operating mode and selected role
   perspectives.
2. Produces draft buyer, supplier, peer and skeptic inquiry strategies.
3. Records that the user prepared or copied a strategy.
4. Records a user attestation that they sent it through a real, authorized
   channel and requires the channel label. The server does not send the
   message.
5. Accepts a user-submitted receipt and computes its SHA-256 content hash on
   the server.
6. Returns the current missions, receipt ledger and event history.

There is no `start` or `complete` action in the evidence-operations API. A plan
cannot silently become evidence.

## Truth and storage boundaries

- Meituan and Google connectors are **not configured**.
- The only available external path is manual: the user sends through an
  authorized channel and explicitly confirms that action.
- A user-submitted receipt is not provider-verified. Its hash supports content
  integrity, not source authenticity.
- `simulation_lab` cannot record real contact or write to the real receipt
  ledger.
- Current server storage is an in-memory prototype. Process restarts remove
  investigations.
- There is no authentication, tenant isolation, durable event store, encrypted
  database, provider webhook verification or compliance-grade approval yet.

These limitations are returned by the API and shown in the frontend.

## DeepSeek planning layer

DeepSeek is opt-in per investigation. It is limited to one structured `PLAN`
operation that can draft:

- objective
- opening question
- follow-up rule
- requested receipt

Fixed role names, perspectives and safety boundaries remain server-controlled.
The server rejects a generated plan when its role set changes or its text
matches the known prohibited identity, deception, fabricated-action, metric,
or conclusion patterns. This filter is a prototype safeguard, not a complete
semantic classifier, so every model draft remains pending human review. The
model has no authority to mark a mission as prepared or contacted, create a
receipt, write a metric, or unlock a conclusion.

The response exposes whether planning used:

- `LIVE`: the configured DeepSeek model returned validated JSON.
- `DETERMINISTIC_FALLBACK`: a call was requested but no valid model result was
  available.
- `NOT_REQUESTED`: the user kept model processing off.

Configuration:

```dotenv
PORT=3001
CORS_ORIGINS=http://localhost:3000
MAX_INVESTIGATIONS=100
MAX_RECEIPTS_PER_INVESTIGATION=32
INVESTIGATION_TTL_MS=14400000
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
ENABLE_LIVE_LLM=false
MAX_LIVE_LLM_HTTP_REQUESTS_PER_PROCESS=8
```

The key is read only from the backend process environment. It is never returned
in API payloads or stored in the repository. A key alone does not enable paid
calls: `ENABLE_LIVE_LLM` must also be exactly `true`. The per-process HTTP
request budget includes retries and is a prototype cost guard, not an
authentication or production rate-limiting system. Do not expose this
unauthenticated prototype API with a live key.

## Run locally

```bash
cp .env.example .env
npm install
npm run start:dev
```

The API runs at `http://localhost:3001/v1`.

## Evidence-operations API

| Method | Endpoint | Meaning |
| --- | --- | --- |
| `GET` | `/v1/evidence-operations/capabilities` | Actual storage, planner and connector state |
| `POST` | `/v1/evidence-operations/investigations` | Create a claim and draft role missions |
| `GET` | `/v1/evidence-operations/investigations/:id` | Read the current truthful state |
| `POST` | `/v1/evidence-operations/investigations/:id/missions/:roleId/prepare` | User confirms local preparation/copy |
| `POST` | `/v1/evidence-operations/investigations/:id/missions/:roleId/contact` | User attests a real authorized send |
| `POST` | `/v1/evidence-operations/investigations/:id/evidence` | Store a user-submitted receipt and server hash |

Example creation request:

```json
{
  "idempotencyKey": "7e505d5d-e337-45e6-9ba2-7d4f5e541579",
  "subject": "Example brand",
  "claim": "Every publicly listed location is operating",
  "sourceNote": "Company-provided material",
  "mode": "assisted_live",
  "roleIds": ["buyer", "supplier", "competitor", "skeptic"],
  "allowModelProcessing": false
}
```

The created missions all start as `planned`. Contact confirmation requires the
selected mission to have a recorded preparation step. Real-contact semantics
and real receipts are rejected in `simulation_lab`. A receipt also requires a
previously confirmed authorized contact action for that role.

Creation requests require a UUID `idempotencyKey`. An exact retry returns the
same investigation; the same key with different input is rejected.

## Verify

```bash
npm run format:check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

The evidence-operations end-to-end tests verify:

- plans start empty of evidence and completion claims;
- connector capability states are explicit;
- user confirmation is required for contact and receipts;
- server receipt hashes use SHA-256;
- an exact retry of a receipt ID is idempotent, while different content under
  the same ID is rejected;
- browser CORS access is limited to configured origins;
- simulation mode cannot create real-contact state;
- DeepSeek fallback provenance stays visible;
- unsafe or role-mismatched generated plans fall back instead of being labeled
  as live model plans;
- the retired `/v1/demo/**` namespace returns `404`.
