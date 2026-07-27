export type LlmOperation = 'PLAN';

export interface LlmProvenance {
  provider: 'deepseek';
  model: string;
  mode: 'LIVE' | 'DETERMINISTIC_FALLBACK';
  operation: LlmOperation;
  attempts: number;
  reason?:
    | 'NO_API_KEY'
    | 'LIVE_DISABLED'
    | 'BUDGET_EXHAUSTED'
    | 'TIMEOUT'
    | 'RATE_LIMIT'
    | 'UPSTREAM_ERROR'
    | 'INVALID_RESPONSE'
    | 'POLICY_REJECTED'
    | 'NETWORK_ERROR';
}
