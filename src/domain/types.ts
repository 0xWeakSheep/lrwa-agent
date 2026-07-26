export type SimulationLabel = 'SIMULATED';

export type InvestigationStatus =
  'DRAFT' | 'PLANNED' | 'APPROVED' | 'RUNNING' | 'COMPLETED';

export type ClaimMetric =
  | 'ACTIVE_STORE_COUNT'
  | 'DAILY_ORDERS_PER_STORE'
  | 'AVERAGE_TICKET'
  | 'MONTHLY_GMV';

export interface Claim {
  id: string;
  metric: ClaimMetric;
  statement: string;
  reportedValue: number;
  unit: string;
  period: string;
}

export type AgentRole =
  | 'SUPERVISOR'
  | 'FIELD_OBSERVER'
  | 'MYSTERY_SHOPPER'
  | 'CHANNEL_AUDITOR'
  | 'LABOR_ANALYST'
  | 'SUPPLY_CHAIN_ANALYST'
  | 'EVIDENCE_AUDITOR'
  | 'STATISTICIAN'
  | 'SKEPTIC';

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  displayName: string;
  mission: string;
  allowedTools: string[];
  guardrails: string[];
}

export type EvidenceFamily =
  | 'STORE_OBSERVATION'
  | 'CUSTOMER_SERVICE'
  | 'LABOR_SIGNAL'
  | 'SUPPLY_CHAIN'
  | 'DIGITAL_FOOTPRINT';

export interface PlanTask {
  id: string;
  agentId: string;
  evidenceFamily: EvidenceFamily;
  objective: string;
  sampleSize: number;
  tool: string;
}

export interface Plan {
  id: string;
  investigationId: string;
  status: 'PROPOSED' | 'APPROVED';
  methodology: string;
  tasks: PlanTask[];
  totalProbes: 1024;
  minimumIndependentFamilies: 2;
  safetyBoundary: string;
}

export interface DemoStore {
  id: string;
  name: string;
  district: string;
  latitude: number;
  longitude: number;
  reportedStatus: 'OPERATING';
}

export interface DemoCase {
  id: string;
  seed: string;
  company: {
    legalName: 'Morrow Coffee (Demo) Ltd.';
    brandName: '晨潮咖啡 Morrow';
    market: '上海';
    description: string;
  };
  disclosure: SimulationLabel;
  claims: Claim[];
  stores: DemoStore[];
  createdAt: string;
}

export interface EvidenceSource {
  label: SimulationLabel;
  family: EvidenceFamily;
  name: string;
  methodology: string;
}

export interface Evidence {
  id: string;
  investigationId: string;
  claimIds: string[];
  source: EvidenceSource;
  agent: {
    id: string;
    role: AgentRole;
  };
  tool: string;
  sampleSize: number;
  collectedAt: string;
  measurements: Record<string, number>;
  storeSignals?: StoreSignal[];
  summary: string;
  hash: string;
}

export interface StoreSignal extends DemoStore {
  observedStatus: 'ACTIVE' | 'INACTIVE';
  signalScore: number;
  observations: number;
}

export type FindingVerdict = 'SUPPORTED' | 'UNSUPPORTED' | 'INCONCLUSIVE';

export interface Finding {
  id: string;
  investigationId: string;
  claimId: string;
  verdict: FindingVerdict;
  confidence: number;
  confidenceBand: 'LOW' | 'MEDIUM' | 'HIGH';
  independentEvidenceFamilies: EvidenceFamily[];
  evidenceIds: string[];
  reportedValue: number;
  estimatedValue: number;
  lowerBound: number;
  upperBound: number;
  gapPercent: number;
  rationale: string;
  actionSuggestions: string[];
}

export type EventType =
  | 'CASE_CREATED'
  | 'PLAN_PROPOSED'
  | 'PLAN_APPROVED'
  | 'INVESTIGATION_STARTED'
  | 'AGENT_DISPATCHED'
  | 'EVIDENCE_CAPTURED'
  | 'EVIDENCE_AUDITED'
  | 'ESTIMATE_COMPUTED'
  | 'FINDING_COMPUTED'
  | 'INVESTIGATION_COMPLETED'
  | 'REPLAY_CREATED'
  | 'HYPOTHESIS_RAISED'
  | 'REPLAY_STARTED';

export interface InvestigationEvent {
  id: string;
  investigationId: string;
  sequence: number;
  type: EventType;
  at: string;
  disclosure: SimulationLabel;
  agentRole: AgentRole;
  message: string;
  data: Record<string, string | number | boolean>;
}

export interface Investigation {
  id: string;
  caseId: string;
  seed: string;
  status: InvestigationStatus;
  disclosure: SimulationLabel;
  supervisor: AgentDefinition;
  agents: AgentDefinition[];
  plan?: Plan;
  startedAt?: string;
  completedAt?: string;
  replayOf?: string;
  proposedHypotheses?: Array<{
    type: 'CORPORATE_ORDER_SHARE';
    corporateOrderShare: number;
    rationale: string;
    proposedBy: 'SKEPTIC';
    status: 'PROPOSED' | 'APPROVED';
    disclosure: SimulationLabel;
  }>;
  hypothesis?: {
    corporateOrderShare: number;
    submittedAt: string;
    disclosure: SimulationLabel;
  };
  summary?: {
    claimsChecked: number;
    evidenceItems: number;
    highConfidenceFindings: number;
    overallRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}
