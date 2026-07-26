# LRWA Demo Methodology

This note describes what the BUIDL_QUESTS 2026 demo actually computes. It is
intentionally explicit about the difference between a reproducible product
demonstration and a calibrated production diligence system.

## Scope and safety boundary

The Morrow Coffee case is fictional. Every source and artifact is labeled
`SIMULATED`. The demo does not contact merchants, impersonate people, place
orders, scrape live platforms, or process personal data.

Future production missions are limited to public, licensed,
customer-authorized, or opt-in sources. Automated communication must disclose
that it is automated. Sensitive collection and every counterfactual replay
would require verified human approval in production. This demo has only an
unauthenticated API/UI interaction gate; it is not an identity-verified or
compliance-grade approval system.

## Verification loop

```mermaid
flowchart LR
  A["Management claim"] --> B["Claim compiler"]
  B --> C["Bounded mission plan"]
  C --> D["Caller interaction gate"]
  D --> E["Five evidence families"]
  E --> F["Evidence verification"]
  F --> G["Deterministic estimate"]
  G --> H["Skeptic hypothesis"]
  H --> I["Caller replay gate"]
  I --> J["Deterministic replay"]
  J --> K["Evidence requests"]
```

The canonical plan contains exactly five tasks and a declared aggregate quota
of 1,024 parameterized probes:

| Evidence category | Planned quota | Observable proxy |
|---|---:|---|
| Store observation | 320 | Operating state, availability, price, and store coverage |
| Synthetic consumer panel | 256 | Pre-order journey, price, and throughput proxy |
| Digital footprint | 192 | Time-series consistency of listing and fulfillment state |
| Labor signal | 128 | Aggregate staffing capacity |
| Supply chain | 128 | Aggregate replenishment capacity |

The current implementation produces one aggregate evidence receipt per family:
five `Evidence` objects in total. The 1,024 probes are aggregate plan quotas
represented by those receipts; the demo does not claim to execute or persist
1,024 independent Agent conversations or raw observations.

Each task is executed separately through the synthetic Agent Executor. Before
an adapter can run, the executor resolves the assigned specialist, checks the
task tool against that role's allowlist, requires declared guardrails, and
enforces a `SIMULATED_ONLY` boundary. The adapter must return the declared
logical category, agent, tool and sample allocation with a valid content hash.
The event ledger records the dispatch, policy check, receipt and completion for
all five tasks. This proves task-level orchestration and runtime policy
enforcement inside the synthetic fixture; it does not prove real-world
observation.

“Evidence family” means a logical category and calculation entry point. All
five families share one synthetic fixture. Their statistical independence,
source independence, and uncorrelated error have not been established.

## Evidence receipts and provenance

Each receipt records:

- linked claims;
- source label, family, name, and methodology;
- responsible agent and tool;
- sample size and deterministic collection time;
- aggregate measurements;
- a SHA-256 hash of the canonical JSON payload.

At runtime the Evidence Auditor recomputes each
`SHA-256(JSON.stringify(payload))` value before findings are calculated. These
hashes establish content identity relative to the payload supplied to the
verifier. They are not a digital signature, external timestamp, Merkle
commitment, immutable ledger, proof of physical observation, or substitute for
source authorization. A writer could alter both a payload and its hash. Storage
uses in-memory maps and is lost on process restart; a production evidence
ledger would require durable append-only storage, access controls, retention
policy, signed source receipts, and external anchoring where appropriate.

## Estimate calculation

For each claim, LRWA selects receipts that:

1. link to the claim;
2. belong to an allowed evidence family for that metric; and
3. contain the required numeric measurement.

The displayed point estimate is the arithmetic mean of the relevant
family-level estimates. In the canonical GMV case, the five family estimates
are:

```text
¥1.86m, ¥1.94m, ¥1.91m, ¥1.93m, ¥1.96m
```

Their mean is ¥1.92m. The reported claim is ¥3.33m, so the displayed absolute
gap is:

```text
abs(1.92 - 3.33) / 3.33 = 42.3%
```

The base interval of ¥1.72m to ¥2.14m is a fixed scenario band for the
synthetic benchmark. It is not presented as an empirically calibrated
frequentist confidence interval.

## Policy confidence and verdict

The API field named `confidence` is a transparent heuristic policy score, not
the probability that a company committed fraud and not a statistically
calibrated posterior.

When at least two allowed evidence families are present:

```text
confidence = min(0.92, 0.78 + 0.02 × family_count) - hypothesis_penalty
```

With fewer than two families, the score is fixed at 0.59 and the result cannot
enter the `HIGH` policy band.

With five logical families and no replay penalty, the heuristic score is 0.88.
A result is `HIGH` only when at least two logical families are present and the
score is at least 0.80. The current code has not calibrated 0.88 against
real-world outcomes.

For `HIGH` confidence:

- gap at or below 8% becomes `SUPPORTED`;
- gap at or above 15% becomes `UNSUPPORTED`;
- the middle band remains `INCONCLUSIVE`.

Any result below `HIGH` confidence is `INCONCLUSIVE`, regardless of the point
estimate. `UNSUPPORTED` means that the current sample does not support the
claim. It is not a fraud finding, statutory audit opinion, legal conclusion, or
investment recommendation.

## Skeptic replay

The Skeptic presents a preconfigured parameterized counterfactual in which an
unobserved corporate-order channel could account for 20% of demand. The 20%
share is not discovered from new evidence. The language model cannot change
evidence or rerun the case autonomously. The replay endpoint validates the
share between 0 and 0.5 and requires a separate caller interaction.

For a share `s`, the synthetic GMV receipts are multiplied by:

```text
1 / (1 - s)
```

The scenario interval is widened by `s × 0.08`, and GMV confidence receives a
penalty of `s × 0.30`.

At `s = 0.20`, the result is:

- estimate: ¥2.40m;
- exact scenario band: ¥2.1156m to ¥2.7178m;
- displayed band: ¥2.12m to ¥2.72m;
- gap: 27.9%;
- confidence: 0.82;
- verdict: `UNSUPPORTED`.

The replay uses the same seed and leaves the original evidence receipts
unchanged. Core numeric outputs are repeatable for the same code version, seed,
and hypothesis. The service is in-memory, and LIVE language-model text is not
guaranteed to be identical across runs.

## DeepSeek boundary

DeepSeek is an optional bounded language layer for three operations:

- `PLAN`: explain the already-fixed mission plan;
- `CHALLENGE`: phrase the already-fixed 20% counter-hypothesis;
- `EXPLANATION`: explain deterministic findings and next actions.

The model does not generate evidence, measurements, hashes, fixed scenario
bands, heuristic policy scores, verdicts, or replay parameters. Responses must
be strict JSON and pass Zod validation. Requests use a 4.5-second timeout, one
short retry for network, 429, or 5xx failures, and a deterministic fallback.
Provenance exposes provider, model, operation, attempts, and `LIVE` or
`DETERMINISTIC_FALLBACK`; application responses and events never expose the API
key, authorization header, or prompts. Prompts are still transmitted to
DeepSeek in LIVE mode. The application does not persist them beyond in-memory
runtime state, but it cannot make retention promises on behalf of the model
provider or hosting platform.

## Reproducibility checks

The test suite verifies:

- 48 fictional stores and a declared aggregate quota of 1,024;
- canonical base and replay values;
- identical core numeric results for the same code version, seed, and
  hypothesis;
- content-hash reconstruction for every evidence receipt;
- the two-family minimum for high-confidence findings;
- REST state transitions and validation;
- task-level agent dispatch, tool-policy checks and blocked unauthorized tools;
- ordered server-sent events;
- no-key DeepSeek fallback, strict JSON parsing, provenance, and retry behavior.

These checks prove consistency with the synthetic fixture. They do not prove
real-world measurement validity, source independence, statistical calibration,
fraud, regulatory compliance, or investment suitability.

Run:

```bash
npm run format:check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

## Production calibration path

The production moat is not the demo's fixed coefficients. It is the governed
system for learning and versioning:

- claim-to-observable mappings;
- spatial and temporal sampling plans;
- source authorization and reliability;
- shared-source dependency detection;
- benchmark-based interval calibration;
- contradiction-driven replanning;
- mission cost versus expected information gain;
- longitudinal outcome feedback.

Before real investment use, LRWA would need authorized data connectors,
documented sampling assumptions, benchmark datasets, calibration and drift
tests, durable provenance, security review, and domain-specific human
oversight.
