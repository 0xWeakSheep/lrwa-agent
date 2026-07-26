import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentInsight,
  DemoCase,
  Evidence,
  Finding,
  Investigation,
  InvestigationEvent,
  InvestigationStatus,
  Plan,
  PlanTask,
} from '../domain/types';
import { DeepSeekService } from '../llm/deepseek.service';
import {
  computeFindings,
  createAgentTeam,
  createMorrowCase,
  deterministicId,
  deterministicTime,
  generateEvidence,
  verifyEvidenceHash,
} from './reality-twin';

export interface DemoCaseBundle {
  case: DemoCase;
  investigation: Investigation;
}

const insightSchema = z
  .object({
    content: z.string().trim().min(1).max(800),
    suggestions: z.array(z.string().trim().min(1).max(240)).max(4),
  })
  .strict();

@Injectable()
export class InvestigationService {
  private readonly cases = new Map<string, DemoCase>();
  private readonly investigations = new Map<string, Investigation>();
  private readonly evidenceByInvestigation = new Map<string, Evidence[]>();
  private readonly findingsByInvestigation = new Map<string, Finding[]>();
  private readonly eventsByInvestigation = new Map<
    string,
    InvestigationEvent[]
  >();

  constructor(private readonly deepSeekService: DeepSeekService) {}

  createDemoCase(seed = 'morrow-demo-2026'): DemoCaseBundle {
    const demoCase = createMorrowCase(seed);
    const existingInvestigation = Array.from(this.investigations.values()).find(
      (investigation) =>
        investigation.caseId === demoCase.id &&
        investigation.replayOf === undefined,
    );
    if (existingInvestigation) {
      return {
        case: this.requireCase(demoCase.id),
        investigation: existingInvestigation,
      };
    }

    const agents = createAgentTeam(seed);
    const supervisor = agents.find((agent) => agent.role === 'SUPERVISOR');
    if (!supervisor) {
      throw new Error('Supervisor agent is required');
    }
    const investigation: Investigation = {
      id: deterministicId('inv', { caseId: demoCase.id, seed, run: 0 }),
      caseId: demoCase.id,
      seed,
      status: 'DRAFT',
      disclosure: 'SIMULATED',
      supervisor,
      agents: agents.filter((agent) => agent.role !== 'SUPERVISOR'),
      llmRuns: [],
      agentInsights: {},
    };
    this.cases.set(demoCase.id, demoCase);
    this.investigations.set(investigation.id, investigation);
    this.evidenceByInvestigation.set(investigation.id, []);
    this.findingsByInvestigation.set(investigation.id, []);
    this.eventsByInvestigation.set(investigation.id, []);
    this.recordEvent(
      investigation,
      'CASE_CREATED',
      'SUPERVISOR',
      '虚构晨潮咖啡尽调案例已创建。',
      { caseId: demoCase.id, seed },
    );
    return { case: demoCase, investigation };
  }

  getCase(caseId: string): DemoCase {
    return this.requireCase(caseId);
  }

  getInvestigation(investigationId: string): Investigation {
    return this.requireInvestigation(investigationId);
  }

  async proposePlan(investigationId: string): Promise<Investigation> {
    const investigation = this.requireInvestigation(investigationId);
    this.assertStatus(investigation, 'DRAFT');
    const tasks: PlanTask[] = [
      {
        id: deterministicId('tsk', { investigationId, family: 'STORE' }),
        agentId: this.agentId(investigation, 'FIELD_OBSERVER'),
        evidenceFamily: 'STORE_OBSERVATION',
        objective: '分层抽样核验披露门店、订单容量与排班覆盖。',
        sampleSize: 320,
        tool: 'visit-sampler',
      },
      {
        id: deterministicId('tsk', { investigationId, family: 'PANEL' }),
        agentId: this.agentId(investigation, 'MYSTERY_SHOPPER'),
        evidenceFamily: 'CUSTOMER_SERVICE',
        objective: '执行合成消费者旅程，核验可达门店和履约容量。',
        sampleSize: 256,
        tool: 'synthetic-panel',
      },
      {
        id: deterministicId('tsk', { investigationId, family: 'DIGITAL' }),
        agentId: this.agentId(investigation, 'CHANNEL_AUDITOR'),
        evidenceFamily: 'DIGITAL_FOOTPRINT',
        objective: '交叉核对三个模拟渠道中的门店营业状态。',
        sampleSize: 192,
        tool: 'simulated-listing-index',
      },
      {
        id: deterministicId('tsk', { investigationId, family: 'LABOR' }),
        agentId: this.agentId(investigation, 'LABOR_ANALYST'),
        evidenceFamily: 'LABOR_SIGNAL',
        objective: '从合成排班与招聘信号估算门店经营容量。',
        sampleSize: 128,
        tool: 'synthetic-labor-ledger',
      },
      {
        id: deterministicId('tsk', { investigationId, family: 'SUPPLY' }),
        agentId: this.agentId(investigation, 'SUPPLY_CHAIN_ANALYST'),
        evidenceFamily: 'SUPPLY_CHAIN',
        objective: '从合成耗材流量推算可支持的订单和 GMV 上限。',
        sampleSize: 128,
        tool: 'synthetic-invoice-ledger',
      },
    ];
    const plan: Plan = {
      id: deterministicId('pln', investigationId),
      investigationId,
      status: 'PROPOSED',
      methodology:
        '以 1,024 个参数化探针的聚合配额，对门店、消费者面板、渠道、用工和供应链进行五路交叉验证。',
      tasks,
      totalProbes: 1024,
      minimumEvidenceFamilies: 2,
      safetyBoundary:
        '本 Demo 仅运行完全虚构的 Reality Twin；不冒充真人、不联系真实企业、不抓取真实个人数据。',
    };
    const planning = await this.deepSeekService.generateJson({
      operation: 'PLAN',
      systemPrompt:
        'You are the planning layer for a synthetic due-diligence demo. Return exactly one JSON object shaped as {"content":"short explanation","suggestions":["short action"]}. Use one to three suggestion strings, no extra keys and no markdown. Never alter supplied probe counts or numerical claims.',
      userPrompt:
        'Explain why five logical evidence families and a 1,024-probe aggregate sampling quota are useful for cross-checking the fictional Morrow claims: 48 stores, 118 daily orders per store, ¥19.6 average ticket, and ¥3.33m June GMV. Do not claim statistical independence.',
      schema: insightSchema,
      fallback: {
        content:
          '以门店、消费者、数字渠道、用工和供应链五个逻辑证据族交叉核验，可降低对单一类别信号的依赖。',
        suggestions: [
          '保持 1,024 个参数化探针的固定分层配额。',
          '任何高置信结论至少依赖两个逻辑证据族。',
        ],
      },
    });
    plan.llmInsight = this.recordLlmUsage(
      investigation,
      planning.value,
      planning.provenance,
      'SUPERVISOR',
    );
    investigation.plan = plan;
    investigation.status = 'PLANNED';
    this.recordEvent(
      investigation,
      'PLAN_PROPOSED',
      'SUPERVISOR',
      '调查主管提出 1,024 探针、五路交叉验证计划，等待人工批准。',
      {
        tasks: tasks.length,
        totalProbes: 1024,
        minimumEvidenceFamilies: 2,
      },
    );
    return investigation;
  }

  approvePlan(investigationId: string): Investigation {
    const investigation = this.requireInvestigation(investigationId);
    this.assertStatus(investigation, 'PLANNED');
    if (!investigation.plan) {
      throw new ConflictException('Investigation has no plan');
    }
    investigation.plan.status = 'APPROVED';
    investigation.status = 'APPROVED';
    this.recordEvent(
      investigation,
      'PLAN_APPROVED',
      'SUPERVISOR',
      '人工审批已通过；调查仍限定在 SIMULATED 环境。',
      { planId: investigation.plan.id },
    );
    return investigation;
  }

  async startInvestigation(investigationId: string): Promise<Investigation> {
    const investigation = this.requireInvestigation(investigationId);
    this.assertStatus(investigation, 'APPROVED');
    const demoCase = this.requireCase(investigation.caseId);
    investigation.status = 'RUNNING';
    investigation.startedAt = deterministicTime(investigation.seed, 10);
    this.recordEvent(
      investigation,
      'INVESTIGATION_STARTED',
      'SUPERVISOR',
      'Reality Twin 调查开始。',
      { planId: investigation.plan?.id ?? '' },
    );

    for (const task of investigation.plan?.tasks ?? []) {
      const role =
        investigation.agents.find((agent) => agent.id === task.agentId)?.role ??
        'SUPERVISOR';
      this.recordEvent(
        investigation,
        'AGENT_DISPATCHED',
        role,
        `${role} 已接收 ${task.evidenceFamily} 任务。`,
        { taskId: task.id, sampleSize: task.sampleSize },
      );
    }

    const evidence = generateEvidence(
      demoCase,
      investigation.id,
      investigation.seed,
      investigation.agents,
      investigation.hypothesis?.corporateOrderShare ?? 0,
    );
    const hashesVerified = evidence.every(verifyEvidenceHash);
    if (!hashesVerified) {
      throw new ConflictException('Evidence hash verification failed');
    }
    this.evidenceByInvestigation.set(investigation.id, evidence);
    for (const item of evidence) {
      this.recordEvent(
        investigation,
        'EVIDENCE_CAPTURED',
        item.agent.role,
        `${item.source.family} 聚合证据已写入可追溯记录。`,
        {
          evidenceId: item.id,
          evidenceHash: item.hash,
          sourceLabel: item.source.label,
        },
      );
    }
    this.recordEvent(
      investigation,
      'EVIDENCE_AUDITED',
      'EVIDENCE_AUDITOR',
      '证据审计员已重新计算并验证五个逻辑证据族的标记、哈希、Agent 与工具链路。',
      {
        evidenceItems: evidence.length,
        logicalEvidenceFamilies: new Set(
          evidence.map((item) => item.source.family),
        ).size,
        hashesVerified,
      },
    );

    const findings = computeFindings(
      demoCase,
      investigation.id,
      evidence,
      investigation.hypothesis?.corporateOrderShare ?? 0,
    );
    this.findingsByInvestigation.set(investigation.id, findings);
    const monthlyGmvFinding = findings.find((finding) => {
      const claim = demoCase.claims.find(
        (candidate) => candidate.id === finding.claimId,
      );
      return claim?.metric === 'MONTHLY_GMV';
    });
    this.recordEvent(
      investigation,
      'ESTIMATE_COMPUTED',
      'STATISTICIAN',
      '统计分析师完成现实估计、固定情景范围与披露差距计算。',
      {
        estimatedMonthlyGmv: monthlyGmvFinding?.estimatedValue ?? 0,
        lowerBound: monthlyGmvFinding?.lowerBound ?? 0,
        upperBound: monthlyGmvFinding?.upperBound ?? 0,
        confidence: monthlyGmvFinding?.confidence ?? 0,
      },
    );
    for (const finding of findings) {
      this.recordEvent(
        investigation,
        'FINDING_COMPUTED',
        'SUPERVISOR',
        `主张交叉验证完成：${finding.verdict}。`,
        {
          findingId: finding.id,
          confidence: finding.confidence,
          evidenceFamilies: finding.evidenceFamilies.length,
        },
      );
    }
    if (investigation.replayOf === undefined) {
      const challenge = await this.deepSeekService.generateJson({
        operation: 'CHALLENGE',
        systemPrompt:
          'You are the skeptic in a synthetic investment due-diligence demo. Return exactly one JSON object shaped as {"content":"short challenge","suggestions":["short action"]}. Use one to three suggestion strings, no extra keys and no markdown. Challenge the conclusion without changing any computed values.',
        userPrompt:
          'The deterministic pipeline estimates fictional Morrow June GMV at ¥1.92m versus ¥3.33m reported, with a ¥1.72m–¥2.14m interval, 42.3% gap, and 0.88 confidence. Frame the pre-approved counter-hypothesis that 20% of orders may be unobserved corporate orders. It must require human approval before replay.',
        schema: insightSchema,
        fallback: {
          content:
            '公开触点可能遗漏企业团购订单；建议用 20% 隐含占比检验这一替代解释。',
          suggestions: [
            '在人工批准后以相同 seed 重放。',
            '记录假设参数并比较 GMV 区间、差距和置信度。',
          ],
        },
      });
      this.recordLlmUsage(
        investigation,
        challenge.value,
        challenge.provenance,
        'SKEPTIC',
      );
      investigation.proposedHypotheses = [
        {
          type: 'CORPORATE_ORDER_SHARE',
          corporateOrderShare: 0.2,
          rationale:
            '公开触点可能遗漏企业团购订单；用 20% 隐含占比测试该替代解释是否足以支持 GMV 披露。',
          proposedBy: 'SKEPTIC',
          status: 'PROPOSED',
          disclosure: 'SIMULATED',
        },
      ];
      this.recordEvent(
        investigation,
        'HYPOTHESIS_RAISED',
        'SKEPTIC',
        '反方审查员提出：是否存在未被公开触点观察到的 20% 企业团购订单？',
        {
          corporateOrderShare: 0.2,
          approvalRequired: true,
          autoReplayBlocked: true,
        },
      );
    }
    const monthlyFindingForExplanation = findings.find(
      (finding) => finding.reportedValue === 3_330_000,
    );
    const explanation = await this.deepSeekService.generateJson({
      operation: 'EXPLANATION',
      systemPrompt:
        'You explain deterministic findings in a synthetic due-diligence demo. Return exactly one JSON object shaped as {"content":"short explanation","suggestions":["short action"]}. Use one to three suggestion strings, no extra keys and no markdown. Do not recalculate, replace, or embellish numerical values.',
      userPrompt: `Explain this deterministic synthetic finding: reported GMV ¥3.33m, estimate ¥${monthlyFindingForExplanation?.estimatedValue ?? 0}, fixed scenario band ¥${monthlyFindingForExplanation?.lowerBound ?? 0}–¥${monthlyFindingForExplanation?.upperBound ?? 0}, gap ${monthlyFindingForExplanation?.gapPercent ?? 0}%, heuristic policy score ${monthlyFindingForExplanation?.confidence ?? 0}, verdict ${monthlyFindingForExplanation?.verdict ?? 'INCONCLUSIVE'}.`,
      schema: insightSchema,
      fallback: {
        content:
          '多源现实信号支持的 GMV 估计显著低于披露值，因此当前披露不获支持；该判断不等同于对真实企业的结论。',
        suggestions:
          monthlyFindingForExplanation?.actionSuggestions.slice(0, 3) ?? [],
      },
    });
    this.recordLlmUsage(
      investigation,
      explanation.value,
      explanation.provenance,
      'STATISTICIAN',
    );

    investigation.status = 'COMPLETED';
    investigation.completedAt = deterministicTime(investigation.seed, 40);
    investigation.summary = {
      claimsChecked: demoCase.claims.length,
      evidenceItems: evidence.length,
      highConfidenceFindings: findings.filter(
        (finding) => finding.confidenceBand === 'HIGH',
      ).length,
      overallRisk: findings.some(
        (finding) =>
          finding.verdict === 'UNSUPPORTED' &&
          finding.confidenceBand === 'HIGH',
      )
        ? 'HIGH'
        : 'LOW',
    };
    this.recordEvent(
      investigation,
      'INVESTIGATION_COMPLETED',
      'SUPERVISOR',
      '调查完成；所有数值均由 seeded Reality Twin 与交叉验证算法生成。',
      {
        findings: findings.length,
        evidenceItems: evidence.length,
        overallRisk: investigation.summary.overallRisk,
      },
    );
    return investigation;
  }

  async replayInvestigation(
    investigationId: string,
    corporateOrderShare: number,
  ): Promise<Investigation> {
    const original = this.requireInvestigation(investigationId);
    this.assertStatus(original, 'COMPLETED');
    const replaySeed = original.seed;
    const replayId = deterministicId('inv', {
      caseId: original.caseId,
      seed: replaySeed,
      replayOf: original.id,
      hypothesis: { corporateOrderShare },
    });
    const existing = this.investigations.get(replayId);
    if (existing) {
      return existing;
    }
    const replay: Investigation = {
      ...original,
      id: replayId,
      status: 'APPROVED',
      startedAt: undefined,
      completedAt: undefined,
      summary: undefined,
      replayOf: original.id,
      hypothesis: {
        corporateOrderShare,
        submittedAt: deterministicTime(replaySeed, 5),
        disclosure: 'SIMULATED',
      },
      proposedHypotheses: (original.proposedHypotheses ?? []).map(
        (hypothesis) => ({
          ...hypothesis,
          status:
            hypothesis.corporateOrderShare === corporateOrderShare
              ? ('APPROVED' as const)
              : hypothesis.status,
        }),
      ),
      llmRuns: [...(original.llmRuns ?? [])],
      agentInsights: { ...(original.agentInsights ?? {}) },
      plan: original.plan
        ? {
            ...original.plan,
            id: deterministicId('pln', {
              original: original.plan.id,
              corporateOrderShare,
            }),
            investigationId: '',
            tasks: original.plan.tasks.map((task) => ({
              ...task,
              id: deterministicId('tsk', {
                original: task.id,
                corporateOrderShare,
              }),
            })),
          }
        : undefined,
    };
    if (replay.plan) {
      replay.plan.investigationId = replay.id;
    }
    this.investigations.set(replay.id, replay);
    this.evidenceByInvestigation.set(replay.id, []);
    this.findingsByInvestigation.set(replay.id, []);
    this.eventsByInvestigation.set(replay.id, []);
    this.recordEvent(
      replay,
      'REPLAY_CREATED',
      'SUPERVISOR',
      '使用相同 seed 创建可重复调查。',
      {
        replayOf: original.id,
        seed: replaySeed,
        corporateOrderShare,
      },
    );
    this.recordEvent(
      replay,
      'REPLAY_STARTED',
      'SUPERVISOR',
      '人工批准反方假设；使用相同现实 seed 和经审计参数重新运行。',
      {
        corporateOrderShare,
        humanApproved: true,
        auditedInput: true,
        reproducible: true,
      },
    );
    return this.startInvestigation(replay.id);
  }

  getEvidence(investigationId: string): Evidence[] {
    this.requireInvestigation(investigationId);
    return this.evidenceByInvestigation.get(investigationId) ?? [];
  }

  getFindings(investigationId: string): Finding[] {
    this.requireInvestigation(investigationId);
    return this.findingsByInvestigation.get(investigationId) ?? [];
  }

  getEvents(investigationId: string): InvestigationEvent[] {
    this.requireInvestigation(investigationId);
    return this.eventsByInvestigation.get(investigationId) ?? [];
  }

  private requireCase(caseId: string): DemoCase {
    const demoCase = this.cases.get(caseId);
    if (!demoCase) {
      throw new NotFoundException(`Case ${caseId} not found`);
    }
    return demoCase;
  }

  private requireInvestigation(investigationId: string): Investigation {
    const investigation = this.investigations.get(investigationId);
    if (!investigation) {
      throw new NotFoundException(`Investigation ${investigationId} not found`);
    }
    return investigation;
  }

  private assertStatus(
    investigation: Investigation,
    expected: InvestigationStatus,
  ): void {
    if (investigation.status !== expected) {
      throw new ConflictException(
        `Expected ${expected}, received ${investigation.status}`,
      );
    }
  }

  private agentId(
    investigation: Investigation,
    role: Investigation['agents'][number]['role'],
  ): string {
    const agent = investigation.agents.find(
      (candidate) => candidate.role === role,
    );
    if (!agent) {
      throw new Error(`Agent ${role} not found`);
    }
    return agent.id;
  }

  private recordEvent(
    investigation: Investigation,
    type: InvestigationEvent['type'],
    agentRole: InvestigationEvent['agentRole'],
    message: string,
    data: InvestigationEvent['data'],
  ): void {
    const events = this.eventsByInvestigation.get(investigation.id) ?? [];
    const sequence = events.length + 1;
    events.push({
      id: deterministicId('evt', {
        investigationId: investigation.id,
        sequence,
        type,
      }),
      investigationId: investigation.id,
      sequence,
      type,
      at: deterministicTime(investigation.seed, sequence),
      disclosure: 'SIMULATED',
      agentRole,
      message,
      data,
    });
    this.eventsByInvestigation.set(investigation.id, events);
  }

  private recordLlmUsage(
    investigation: Investigation,
    value: z.infer<typeof insightSchema>,
    provenance: AgentInsight['provenance'],
    agentRole: InvestigationEvent['agentRole'],
  ): AgentInsight {
    const insight: AgentInsight = {
      operation: provenance.operation,
      content: value.content,
      suggestions: value.suggestions,
      provenance,
    };
    investigation.llmRuns = [...(investigation.llmRuns ?? []), provenance];
    investigation.agentInsights = {
      ...(investigation.agentInsights ?? {}),
      [provenance.operation]: insight,
    };
    this.recordEvent(
      investigation,
      'LLM_LAYER_USED',
      agentRole,
      `${provenance.operation} 文字推理层已完成；数值管线保持确定性。`,
      {
        provider: provenance.provider,
        model: provenance.model,
        mode: provenance.mode,
        operation: provenance.operation,
        attempts: provenance.attempts,
        reason: provenance.reason ?? '',
      },
    );
    return insight;
  }
}
