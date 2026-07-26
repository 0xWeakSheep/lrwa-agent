import { createHash } from 'node:crypto';
import type {
  AgentDefinition,
  Claim,
  ClaimMetric,
  DemoCase,
  DemoStore,
  Evidence,
  EvidenceFamily,
  Finding,
  StoreSignal,
} from '../domain/types';

interface EvidenceDraft {
  claimMetrics: ClaimMetric[];
  family: EvidenceFamily;
  sourceName: string;
  methodology: string;
  agentRole: AgentDefinition['role'];
  tool: string;
  sampleSize: number;
  measurements: Record<string, number>;
  storeSignals?: StoreSignal[];
  summary: string;
}

interface MetricRule {
  measurementKey: string;
  families: EvidenceFamily[];
  baseBounds: [number, number];
  suggestions: string[];
}

const metricRules: Record<ClaimMetric, MetricRule> = {
  ACTIVE_STORE_COUNT: {
    measurementKey: 'estimatedActiveStoreCount',
    families: [
      'STORE_OBSERVATION',
      'CUSTOMER_SERVICE',
      'LABOR_SIGNAL',
      'DIGITAL_FOOTPRINT',
    ],
    baseBounds: [37, 41],
    suggestions: [
      '抽查 9 家被判定为非活跃的披露门店。',
      '要求公司提供六月逐店收银与租赁凭证。',
    ],
  },
  DAILY_ORDERS_PER_STORE: {
    measurementKey: 'estimatedDailyOrdersPerStore',
    families: [
      'STORE_OBSERVATION',
      'CUSTOMER_SERVICE',
      'LABOR_SIGNAL',
      'SUPPLY_CHAIN',
    ],
    baseBounds: [77, 91],
    suggestions: [
      '对高峰时段订单号进行连续性核验。',
      '将杯具耗用量与逐店订单流水交叉匹配。',
    ],
  },
  AVERAGE_TICKET: {
    measurementKey: 'estimatedAverageTicket',
    families: ['STORE_OBSERVATION', 'CUSTOMER_SERVICE'],
    baseBounds: [19.2, 20.1],
    suggestions: ['继续核验优惠券补贴是否被计入净收入。'],
  },
  MONTHLY_GMV: {
    measurementKey: 'estimatedMonthlyGmv',
    families: [
      'STORE_OBSERVATION',
      'CUSTOMER_SERVICE',
      'DIGITAL_FOOTPRINT',
      'LABOR_SIGNAL',
      'SUPPLY_CHAIN',
    ],
    baseBounds: [1_720_000, 2_140_000],
    suggestions: [
      '要求提供六月逐店、逐渠道支付流水。',
      '重点核验企业团购订单及其回款凭证。',
      '在投资条款中加入收入真实性专项交割条件。',
    ],
  },
};

const districtCenters = [
  { district: '黄浦', latitude: 31.2304, longitude: 121.4737 },
  { district: '徐汇', latitude: 31.1883, longitude: 121.4365 },
  { district: '静安', latitude: 31.223, longitude: 121.445 },
  { district: '浦东', latitude: 31.2215, longitude: 121.5444 },
  { district: '长宁', latitude: 31.2204, longitude: 121.4246 },
  { district: '杨浦', latitude: 31.2595, longitude: 121.526 },
  { district: '虹口', latitude: 31.2646, longitude: 121.5051 },
  { district: '普陀', latitude: 31.2495, longitude: 121.397 },
] as const;

function seedNumber(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32LE(0);
}

function mulberry32(initial: number): () => number {
  let state = initial;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number, digits = 0): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}_${stableHash(value).slice(0, 12)}`;
}

export function deterministicTime(seed: string, sequence: number): string {
  const dayOffset = seedNumber(seed) % 20;
  const base = Date.UTC(2026, 5, 1 + dayOffset, 1, 0, 0);
  return new Date(base + sequence * 60_000).toISOString();
}

export function createAgentTeam(seed: string): AgentDefinition[] {
  const definitions: Omit<AgentDefinition, 'id'>[] = [
    {
      role: 'SUPERVISOR',
      displayName: 'Lin / 调查主管',
      mission: '审批方法、调度专业 Agent，并执行独立证据交叉验证。',
      allowedTools: ['policy-engine', 'evidence-ledger', 'confidence-model'],
      guardrails: [
        '只允许访问虚构 Reality Twin',
        '不冒充真人或联系真实商户',
        '高置信结论至少需要两个独立证据族',
      ],
    },
    {
      role: 'FIELD_OBSERVER',
      displayName: 'Aster / 门店观察员',
      mission: '在模拟商圈中执行分时段门店观察与客流抽样。',
      allowedTools: ['simulated-map', 'visit-sampler'],
      guardrails: ['只采集聚合统计', '所有产物标记 SIMULATED'],
    },
    {
      role: 'MYSTERY_SHOPPER',
      displayName: 'Kite / 消费者面板',
      mission: '运行合成消费者旅程，测量门店可达性与履约容量。',
      allowedTools: ['synthetic-panel', 'simulated-support'],
      guardrails: ['禁止与真实人员交互', '禁止形成真实订单'],
    },
    {
      role: 'CHANNEL_AUDITOR',
      displayName: 'Delta / 渠道审计员',
      mission: '核对模拟地图与外卖渠道中的营业状态。',
      allowedTools: ['simulated-listing-index'],
      guardrails: ['不抓取真实平台', '记录数据来源与样本口径'],
    },
    {
      role: 'LABOR_ANALYST',
      displayName: 'Iris / 用工分析师',
      mission: '从合成排班与招聘信号估算门店经营容量。',
      allowedTools: ['synthetic-labor-ledger'],
      guardrails: ['不处理真实个人信息', '仅输出聚合估计'],
    },
    {
      role: 'SUPPLY_CHAIN_ANALYST',
      displayName: 'Forge / 供应链分析师',
      mission: '从合成耗材批次推算实际订单与 GMV 容量。',
      allowedTools: ['synthetic-invoice-ledger'],
      guardrails: ['不访问真实供应商', '保留推导公式'],
    },
    {
      role: 'EVIDENCE_AUDITOR',
      displayName: 'Seal / 证据审计员',
      mission: '验证证据来源、内容哈希、Agent 与工具调用的可追溯性。',
      allowedTools: ['evidence-ledger', 'hash-verifier'],
      guardrails: ['不得修改原始证据', '发现缺失链路必须阻止高置信结论'],
    },
    {
      role: 'STATISTICIAN',
      displayName: 'Sigma / 统计分析师',
      mission: '聚合独立证据族，计算现实估计、区间、差距与置信度。',
      allowedTools: ['confidence-model', 'interval-estimator'],
      guardrails: ['不得用单一证据族输出高置信结论', '保留计算口径'],
    },
    {
      role: 'SKEPTIC',
      displayName: 'Raven / 反方审查员',
      mission: '主动挑战初步结论，提出可审计、可重放的替代解释。',
      allowedTools: ['hypothesis-register', 'counterfactual-planner'],
      guardrails: [
        '只能提出假设，不能绕过人工审批启动重放',
        '所有参数必须留痕',
      ],
    },
  ];
  return definitions.map((definition) => ({
    ...definition,
    id: deterministicId('agt', { seed, role: definition.role }),
  }));
}

function createStores(seed: string): DemoStore[] {
  const random = mulberry32(seedNumber(`${seed}:store-map`));
  return Array.from({ length: 48 }, (_, index) => {
    const center = districtCenters[index % districtCenters.length];
    return {
      id: deterministicId('sto', { seed, index }),
      name: `晨潮咖啡 ${center.district}${String(index + 1).padStart(2, '0')}店`,
      district: center.district,
      latitude: round(center.latitude + (random() - 0.5) * 0.045, 6),
      longitude: round(center.longitude + (random() - 0.5) * 0.055, 6),
      reportedStatus: 'OPERATING',
    };
  });
}

export function createMorrowCase(seed: string): DemoCase {
  const id = deterministicId('case', { brand: 'morrow', seed });
  const claimInput: Omit<Claim, 'id'>[] = [
    {
      metric: 'ACTIVE_STORE_COUNT',
      statement: '晨潮咖啡在上海共有 48 家持续营业门店。',
      reportedValue: 48,
      unit: '家',
      period: '2026-06',
    },
    {
      metric: 'DAILY_ORDERS_PER_STORE',
      statement: '上海区域单店日均完成 118 单。',
      reportedValue: 118,
      unit: '单/店/日',
      period: '2026-06',
    },
    {
      metric: 'AVERAGE_TICKET',
      statement: '上海区域平均客单价为 19.6 元。',
      reportedValue: 19.6,
      unit: '元',
      period: '2026-06',
    },
    {
      metric: 'MONTHLY_GMV',
      statement: '上海区域六月 GMV 为 333 万元。',
      reportedValue: 3_330_000,
      unit: '元/月',
      period: '2026-06',
    },
  ];
  return {
    id,
    seed,
    company: {
      legalName: 'Morrow Coffee (Demo) Ltd.',
      brandName: '晨潮咖啡 Morrow',
      market: '上海',
      description:
        '完全虚构的咖啡连锁 Reality Twin，仅用于黑客松演示，不代表任何真实企业。',
    },
    disclosure: 'SIMULATED',
    claims: claimInput.map((claim) => ({
      ...claim,
      id: deterministicId('clm', { id, metric: claim.metric }),
    })),
    stores: createStores(seed),
    createdAt: deterministicTime(seed, 0),
  };
}

function createStoreSignals(stores: DemoStore[], seed: string): StoreSignal[] {
  const random = mulberry32(seedNumber(`${seed}:store-reality`));
  const order = stores
    .map((store) => ({ store, key: random() }))
    .sort((left, right) => left.key - right.key);
  const activeIds = new Set(order.slice(0, 39).map(({ store }) => store.id));
  return stores.map((store) => {
    const active = activeIds.has(store.id);
    return {
      ...store,
      observedStatus: active ? 'ACTIVE' : 'INACTIVE',
      signalScore: round(
        active ? 0.82 + random() * 0.16 : 0.08 + random() * 0.2,
        2,
      ),
      observations: active
        ? 7 + Math.floor(random() * 4)
        : 6 + Math.floor(random() * 5),
    };
  });
}

function agentFor(
  agents: AgentDefinition[],
  role: AgentDefinition['role'],
): AgentDefinition {
  const agent = agents.find((candidate) => candidate.role === role);
  if (!agent) {
    throw new Error(`Missing required agent role: ${role}`);
  }
  return agent;
}

export function generateEvidence(
  demoCase: DemoCase,
  investigationId: string,
  seed: string,
  agents: AgentDefinition[],
  corporateOrderShare = 0,
): Evidence[] {
  const storeSignals = createStoreSignals(demoCase.stores, seed);
  const gmvMultiplier = 1 / (1 - corporateOrderShare);
  const gmvEstimates = [
    1_860_000, 1_940_000, 1_910_000, 1_930_000, 1_960_000,
  ].map((value) => round(value * gmvMultiplier));
  const drafts: EvidenceDraft[] = [
    {
      claimMetrics: [
        'ACTIVE_STORE_COUNT',
        'DAILY_ORDERS_PER_STORE',
        'AVERAGE_TICKET',
        'MONTHLY_GMV',
      ],
      family: 'STORE_OBSERVATION',
      sourceName: 'Morrow Reality Twin / 门店分时段观察',
      methodology:
        '320 个参数化探针覆盖 48 个披露点位，并将营业、交易和价格信号外推。',
      agentRole: 'FIELD_OBSERVER',
      tool: 'visit-sampler',
      sampleSize: 320,
      measurements: {
        estimatedActiveStoreCount: 39,
        estimatedDailyOrdersPerStore: 82,
        estimatedAverageTicket: 19.5,
        estimatedMonthlyGmv: gmvEstimates[0],
        corporateOrderShare,
      },
      storeSignals,
      summary: '48 个披露点位中，39 个呈现持续经营信号。',
    },
    {
      claimMetrics: [
        'ACTIVE_STORE_COUNT',
        'DAILY_ORDERS_PER_STORE',
        'AVERAGE_TICKET',
        'MONTHLY_GMV',
      ],
      family: 'CUSTOMER_SERVICE',
      sourceName: 'Morrow Reality Twin / 合成消费者面板',
      methodology:
        '256 个参数化消费者探针在封闭环境中执行选店、询价和下单前旅程。',
      agentRole: 'MYSTERY_SHOPPER',
      tool: 'synthetic-panel',
      sampleSize: 256,
      measurements: {
        estimatedActiveStoreCount: 39,
        estimatedDailyOrdersPerStore: 86,
        estimatedAverageTicket: 19.7,
        estimatedMonthlyGmv: gmvEstimates[1],
        corporateOrderShare,
      },
      summary: '合成旅程确认客单价，但不支持披露的单店订单量。',
    },
    {
      claimMetrics: ['ACTIVE_STORE_COUNT', 'MONTHLY_GMV'],
      family: 'DIGITAL_FOOTPRINT',
      sourceName: 'Morrow Reality Twin / 模拟渠道目录',
      methodology: '192 个渠道探针对营业状态与可履约性做时序一致性检查。',
      agentRole: 'CHANNEL_AUDITOR',
      tool: 'simulated-listing-index',
      sampleSize: 192,
      measurements: {
        estimatedActiveStoreCount: 39,
        estimatedMonthlyGmv: gmvEstimates[2],
        corporateOrderShare,
      },
      summary: '九个披露点位在模拟渠道中持续出现关闭或不可履约信号。',
    },
    {
      claimMetrics: [
        'ACTIVE_STORE_COUNT',
        'DAILY_ORDERS_PER_STORE',
        'MONTHLY_GMV',
      ],
      family: 'LABOR_SIGNAL',
      sourceName: 'Morrow Reality Twin / 合成排班账本',
      methodology: '128 个用工探针聚合模拟排班覆盖与岗位容量。',
      agentRole: 'LABOR_ANALYST',
      tool: 'synthetic-labor-ledger',
      sampleSize: 128,
      measurements: {
        estimatedActiveStoreCount: 39,
        estimatedDailyOrdersPerStore: 83,
        estimatedMonthlyGmv: gmvEstimates[3],
        corporateOrderShare,
      },
      summary: '合成排班容量支持约 39 家活跃门店，而非披露的 48 家。',
    },
    {
      claimMetrics: ['DAILY_ORDERS_PER_STORE', 'MONTHLY_GMV'],
      family: 'SUPPLY_CHAIN',
      sourceName: 'Morrow Reality Twin / 合成耗材批次',
      methodology: '128 个供应链探针从杯具、豆料和包装交集推算经营容量。',
      agentRole: 'SUPPLY_CHAIN_ANALYST',
      tool: 'synthetic-invoice-ledger',
      sampleSize: 128,
      measurements: {
        estimatedDailyOrdersPerStore: 84,
        estimatedMonthlyGmv: gmvEstimates[4],
        corporateOrderShare,
      },
      summary: '耗材流量无法支持 333 万元的六月 GMV 披露。',
    },
  ];

  return drafts.map((draft, index) => {
    const agent = agentFor(agents, draft.agentRole);
    const payload = {
      id: deterministicId('evd', {
        investigationId,
        family: draft.family,
      }),
      investigationId,
      claimIds: demoCase.claims
        .filter((claim) => draft.claimMetrics.includes(claim.metric))
        .map((claim) => claim.id),
      source: {
        label: 'SIMULATED' as const,
        family: draft.family,
        name: draft.sourceName,
        methodology: draft.methodology,
      },
      agent: { id: agent.id, role: agent.role },
      tool: draft.tool,
      sampleSize: draft.sampleSize,
      collectedAt: deterministicTime(seed, 20 + index),
      measurements: draft.measurements,
      ...(draft.storeSignals ? { storeSignals: draft.storeSignals } : {}),
      summary: draft.summary,
    };
    return { ...payload, hash: stableHash(payload) };
  });
}

function boundsFor(
  metric: ClaimMetric,
  corporateOrderShare: number,
): [number, number] {
  const [lower, upper] = metricRules[metric].baseBounds;
  if (metric !== 'MONTHLY_GMV' || corporateOrderShare === 0) {
    return [lower, upper];
  }
  const multiplier = 1 / (1 - corporateOrderShare);
  const scenarioUncertainty = corporateOrderShare * 0.08;
  return [
    round(lower * multiplier * (1 - scenarioUncertainty)),
    round(upper * multiplier * (1 + scenarioUncertainty)),
  ];
}

export function computeFindings(
  demoCase: DemoCase,
  investigationId: string,
  evidence: Evidence[],
  corporateOrderShare = 0,
): Finding[] {
  return demoCase.claims.map((claim) => {
    const rule = metricRules[claim.metric];
    const relevant = evidence.filter(
      (item) =>
        item.claimIds.includes(claim.id) &&
        rule.families.includes(item.source.family) &&
        typeof item.measurements[rule.measurementKey] === 'number',
    );
    const families = Array.from(
      new Set(relevant.map((item) => item.source.family)),
    );
    const estimates = relevant.map(
      (item) => item.measurements[rule.measurementKey],
    );
    const estimatedValue =
      estimates.length === 0
        ? 0
        : round(
            estimates.reduce((sum, value) => sum + value, 0) / estimates.length,
            claim.metric === 'AVERAGE_TICKET' ||
              claim.metric === 'DAILY_ORDERS_PER_STORE'
              ? 1
              : 0,
          );
    const gapPercent =
      claim.reportedValue === 0
        ? 0
        : round(
            (Math.abs(estimatedValue - claim.reportedValue) /
              claim.reportedValue) *
              100,
            1,
          );
    const hypothesisPenalty =
      claim.metric === 'MONTHLY_GMV' ? corporateOrderShare * 0.3 : 0;
    const confidence =
      families.length < 2
        ? 0.59
        : round(
            Math.min(0.92, 0.78 + families.length * 0.02) - hypothesisPenalty,
            2,
          );
    const confidenceBand =
      families.length >= 2 && confidence >= 0.8
        ? 'HIGH'
        : confidence >= 0.6
          ? 'MEDIUM'
          : 'LOW';
    const verdict =
      confidenceBand !== 'HIGH'
        ? 'INCONCLUSIVE'
        : gapPercent <= 8
          ? 'SUPPORTED'
          : gapPercent >= 15
            ? 'UNSUPPORTED'
            : 'INCONCLUSIVE';
    const [lowerBound, upperBound] = boundsFor(
      claim.metric,
      corporateOrderShare,
    );

    return {
      id: deterministicId('fnd', { investigationId, claimId: claim.id }),
      investigationId,
      claimId: claim.id,
      verdict,
      confidence,
      confidenceBand,
      independentEvidenceFamilies: families,
      evidenceIds: relevant.map((item) => item.id),
      reportedValue: claim.reportedValue,
      estimatedValue,
      lowerBound,
      upperBound,
      gapPercent,
      rationale:
        confidenceBand === 'HIGH'
          ? `${families.length} 个独立证据族交叉验证；现实估计与披露值相差 ${gapPercent}%。`
          : `仅有 ${families.length} 个独立证据族，按政策不得输出高置信结论。`,
      actionSuggestions: rule.suggestions,
    };
  });
}
