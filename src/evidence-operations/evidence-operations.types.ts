import type { LlmProvenance } from '../llm/deepseek.types';

export const evidenceRoleIds = [
  'buyer',
  'supplier',
  'competitor',
  'skeptic',
] as const;

export type EvidenceRoleId = (typeof evidenceRoleIds)[number];

export const evidenceOperationModes = [
  'assisted_live',
  'authorized_connector',
  'simulation_lab',
] as const;

export type EvidenceOperationMode = (typeof evidenceOperationModes)[number];

export type EvidenceMissionStatus =
  'planned' | 'prepared' | 'contacted' | 'evidence_received';

export type EvidenceStance = 'supports' | 'contradicts' | 'context';

export interface EvidenceRoleMission {
  id: EvidenceRoleId;
  code: string;
  name: string;
  perspective: string;
  objective: string;
  opening: string;
  followUp: string;
  receipt: string;
  boundary: string;
  status: EvidenceMissionStatus;
  preparedAt?: string;
  contactedAt?: string;
  contactChannel?: string;
}

export interface EvidenceReceiptRecord {
  id: string;
  roleId: EvidenceRoleId;
  sourceLabel: string;
  sourceUrl?: string;
  capturedText: string;
  stance: EvidenceStance;
  capturedAt: string;
  recordedAt: string;
  contentHash: string;
  authorization: 'user_confirmed';
}

export type EvidenceOperationEventType =
  | 'INVESTIGATION_CREATED'
  | 'PLAN_CREATED'
  | 'STRATEGY_PREPARED'
  | 'CONTACT_CONFIRMED'
  | 'EVIDENCE_RECORDED';

export interface EvidenceOperationEvent {
  id: string;
  type: EvidenceOperationEventType;
  at: string;
  actor: 'SYSTEM' | 'USER_CONFIRMED';
  roleId?: EvidenceRoleId;
  message: string;
}

export interface EvidencePlanningProvenance {
  engine: 'LOCAL_TEMPLATE' | 'DEEPSEEK';
  mode: 'NOT_REQUESTED' | LlmProvenance['mode'];
  model?: string;
  reason?: LlmProvenance['reason'];
}

export interface EvidenceOperationsInvestigation {
  version: 2;
  id: string;
  subject: string;
  claim: string;
  sourceNote?: string;
  mode: EvidenceOperationMode;
  createdAt: string;
  updatedAt: string;
  storage: {
    kind: 'VOLATILE_IN_MEMORY';
    warning: string;
  };
  externalAccess: {
    state: 'NOT_CONFIGURED';
    detail: string;
  };
  planning: EvidencePlanningProvenance;
  missions: EvidenceRoleMission[];
  evidence: EvidenceReceiptRecord[];
  events: EvidenceOperationEvent[];
}

export interface EvidenceOperationsCapabilities {
  service: 'evidence-operations';
  storage: {
    state: 'VOLATILE_IN_MEMORY';
    durable: false;
  };
  languagePlanner: {
    provider: 'deepseek';
    state: 'ENABLED' | 'DISABLED' | 'NOT_CONFIGURED';
    model: string;
    boundary: string;
  };
  connectors: Array<{
    id: 'manual_authorized_channel' | 'meituan_partner' | 'google_places';
    state: 'AVAILABLE' | 'NOT_CONFIGURED';
    boundary: string;
  }>;
}

export interface CreateEvidenceInvestigationInput {
  idempotencyKey: string;
  subject: string;
  claim: string;
  sourceNote?: string;
  mode: EvidenceOperationMode;
  roleIds: EvidenceRoleId[];
  allowModelProcessing: boolean;
}

export interface AddEvidenceReceiptInput {
  id: string;
  roleId: EvidenceRoleId;
  sourceLabel: string;
  sourceUrl?: string;
  capturedText: string;
  stance: EvidenceStance;
  capturedAt: string;
}
