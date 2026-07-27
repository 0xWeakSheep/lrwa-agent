import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DeepSeekService } from '../llm/deepseek.service';
import type {
  AddEvidenceReceiptInput,
  CreateEvidenceInvestigationInput,
  EvidenceMissionStatus,
  EvidenceOperationEvent,
  EvidenceOperationsCapabilities,
  EvidenceOperationsInvestigation,
  EvidencePlanningProvenance,
  EvidenceRoleId,
  EvidenceRoleMission,
} from './evidence-operations.types';

type RoleTemplate = Omit<
  EvidenceRoleMission,
  'status' | 'preparedAt' | 'contactedAt' | 'contactChannel'
>;

const roleTemplates: Record<EvidenceRoleId, RoleTemplate> = {
  buyer: {
    id: 'buyer',
    code: 'BUYER',
    name: '买家视角',
    perspective: '从真实购买旅程验证可售、交付与售后',
    objective: '确认公开承诺在实际咨询路径中是否成立。',
    opening:
      '我正在评估购买或到店体验，想确认目前实际可购买的产品、覆盖范围和高峰期可用情况。',
    followUp:
      '如果只得到模板回复，追问具体门店、时间窗口、交付限制和例外情况。',
    receipt: '客服原文、可用性页面、时间戳与对应入口',
    boundary: '使用真实主体和授权账号，不虚构个人资料。',
  },
  supplier: {
    id: 'supplier',
    code: 'SUPPLY',
    name: '供应链视角',
    perspective: '从合作前置问题验证补货、覆盖与产能',
    objective: '寻找经营规模与供应链能力之间能否相互解释。',
    opening:
      '我们正在评估潜在供货合作，想了解当前覆盖区域、补货频率、交付批次和验收流程。',
    followUp: '把模糊的规模表述落到频率、区域、最小批次和异常处理方式。',
    receipt: '授权沟通记录、公开合作条款或客户提供的供应资料',
    boundary: '涉及合作身份时必须由真实企业主体发起。',
  },
  competitor: {
    id: 'competitor',
    code: 'PEER',
    name: '同类样本',
    perspective: '用同一口径比较公开门店、价格与履约',
    objective: '建立可重复的同类样本，避免只看目标公司的自述。',
    opening: '按同一时间窗口和同一地理范围记录目标与同类品牌的公开可见信息。',
    followUp: '对缺失或冲突字段保留未知状态，不用行业均值自动补齐。',
    receipt: '公开页面快照、检索条件、采集时间与字段口径',
    boundary: '只使用允许访问的公开页面或正式数据接口。',
  },
  skeptic: {
    id: 'skeptic',
    code: 'SKEPTIC',
    name: '财务挑战者',
    perspective: '主动寻找能推翻当前判断的替代解释',
    objective: '让每个差异都对应一个可被证伪的替代假设。',
    opening:
      '哪些未覆盖渠道、季节因素或会计口径，可能让现有证据低估或误解这项主张？',
    followUp: '把每个替代解释转成下一条证据请求，而不是直接写进结论。',
    receipt: '替代假设、所需原始凭证和可改变决策的阈值',
    boundary: '不把缺失证据当作负面证据。',
  },
};

const generatedPlanSchema = z
  .object({
    missions: z
      .array(
        z
          .object({
            id: z.enum(['buyer', 'supplier', 'competitor', 'skeptic']),
            objective: z.string().trim().min(1).max(240),
            opening: z.string().trim().min(1).max(360),
            followUp: z.string().trim().min(1).max(360),
            receipt: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

const prohibitedPlanContent =
  /假身份|虚假身份|假借|冒充|伪装成|假装成|谎称|虚构|小号|隐瞒.{0,8}身份|不披露.{0,8}自动化|欺骗|绕过|规避.{0,8}权限|批量注册|已发送|已联系|已调查|已访问|已走访|[0-9一二三四五六七八九十百千万两]+家门店|销量|销售额|营收|利润|估值|置信度|结论|impersonat|fake identit|decept|bypass|undisclosed|scrap|contacted|message was sent|pose as|pretend to be|claim(?:ed)? to have|visited .{0,24}(?:stores|locations)|revenue|profit|valuation|confidence|fraud/i;

function generatedPlanPassesPolicy(
  plan: z.infer<typeof generatedPlanSchema>,
): boolean {
  return plan.missions.every((mission) =>
    [
      mission.objective,
      mission.opening,
      mission.followUp,
      mission.receipt,
    ].every((value) => !prohibitedPlanContent.test(value)),
  );
}

function now(): string {
  return new Date().toISOString();
}

function advanceStatus(
  current: EvidenceMissionStatus,
  candidate: EvidenceMissionStatus,
): EvidenceMissionStatus {
  const statuses: EvidenceMissionStatus[] = [
    'planned',
    'prepared',
    'contacted',
    'evidence_received',
  ];
  return statuses.indexOf(candidate) > statuses.indexOf(current)
    ? candidate
    : current;
}

@Injectable()
export class EvidenceOperationsService {
  private readonly investigations = new Map<
    string,
    EvidenceOperationsInvestigation
  >();
  private readonly completedCreateRequests = new Map<
    string,
    { fingerprint: string; investigationId: string }
  >();
  private readonly pendingCreateRequests = new Map<
    string,
    {
      fingerprint: string;
      promise: Promise<EvidenceOperationsInvestigation>;
    }
  >();
  private pendingInvestigationCreates = 0;

  constructor(
    private readonly deepSeekService: DeepSeekService,
    private readonly configService: ConfigService,
  ) {}

  getCapabilities(): EvidenceOperationsCapabilities {
    const model =
      this.configService.get<string>('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash';
    const hasApiKey = Boolean(
      this.configService.get<string>('DEEPSEEK_API_KEY'),
    );
    const liveEnabled =
      this.configService.get<string>('ENABLE_LIVE_LLM') === 'true';
    return {
      service: 'evidence-operations',
      storage: {
        state: 'VOLATILE_IN_MEMORY',
        durable: false,
      },
      languagePlanner: {
        provider: 'deepseek',
        state: !hasApiKey
          ? 'NOT_CONFIGURED'
          : liveEnabled
            ? 'ENABLED'
            : 'DISABLED',
        model,
        boundary:
          '仅生成待审核的询问策略，不能生成证据、外部动作、指标或结论。',
      },
      connectors: [
        {
          id: 'manual_authorized_channel',
          state: 'AVAILABLE',
          boundary: '用户自行从真实授权渠道发送，并明确确认动作。',
        },
        {
          id: 'meituan_partner',
          state: 'NOT_CONFIGURED',
          boundary: '需要正式合作权限或客户授权，当前不会自动访问。',
        },
        {
          id: 'google_places',
          state: 'NOT_CONFIGURED',
          boundary: '当前没有服务端凭证，也不会以脚本数据替代。',
        },
      ],
    };
  }

  async createInvestigation(
    input: CreateEvidenceInvestigationInput,
  ): Promise<EvidenceOperationsInvestigation> {
    if (input.mode === 'authorized_connector') {
      throw new ConflictException(
        'Authorized connector mode is not configured',
      );
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    this.pruneExpiredInvestigations();
    const completed = this.completedCreateRequests.get(input.idempotencyKey);
    if (completed) {
      if (completed.fingerprint !== fingerprint) {
        throw new ConflictException(
          'Idempotency key already belongs to a different request',
        );
      }
      return this.getInvestigation(completed.investigationId);
    }
    const pending = this.pendingCreateRequests.get(input.idempotencyKey);
    if (pending) {
      if (pending.fingerprint !== fingerprint) {
        throw new ConflictException(
          'Idempotency key already belongs to a different request',
        );
      }
      return pending.promise;
    }

    const promise = this.createInvestigationOnce(input);
    this.pendingCreateRequests.set(input.idempotencyKey, {
      fingerprint,
      promise,
    });
    try {
      const investigation = await promise;
      this.completedCreateRequests.set(input.idempotencyKey, {
        fingerprint,
        investigationId: investigation.id,
      });
      return investigation;
    } finally {
      this.pendingCreateRequests.delete(input.idempotencyKey);
    }
  }

  private async createInvestigationOnce(
    input: CreateEvidenceInvestigationInput,
  ): Promise<EvidenceOperationsInvestigation> {
    if (
      this.investigations.size + this.pendingInvestigationCreates >=
      this.getPositiveConfig('MAX_INVESTIGATIONS', 100)
    ) {
      throw new ServiceUnavailableException(
        'Prototype investigation capacity reached',
      );
    }
    this.pendingInvestigationCreates += 1;
    try {
      return await this.createInvestigationWithReservedSlot(input);
    } finally {
      this.pendingInvestigationCreates -= 1;
    }
  }

  private async createInvestigationWithReservedSlot(
    input: CreateEvidenceInvestigationInput,
  ): Promise<EvidenceOperationsInvestigation> {
    const selectedRoleIds = [...new Set(input.roleIds)];
    const fallbackMissions = selectedRoleIds.map((roleId) => ({
      ...roleTemplates[roleId],
      status: 'planned' as const,
    }));

    let missions = fallbackMissions;
    let planning: EvidencePlanningProvenance = {
      engine: 'LOCAL_TEMPLATE',
      mode: 'NOT_REQUESTED',
    };

    if (input.allowModelProcessing) {
      const generated = await this.deepSeekService.generateJson({
        operation: 'PLAN',
        systemPrompt:
          'You design bounded commercial-verification inquiry strategies. Return exactly one JSON object shaped as {"missions":[{"id":"buyer|supplier|competitor|skeptic","objective":"...","opening":"...","followUp":"...","receipt":"..."}]}. Write in concise Chinese. Include exactly the requested role ids once each. These are drafts only. Do not claim any message was sent, any source was contacted, or any evidence, store count, sales figure, financial estimate, confidence score, or conclusion exists. Do not suggest fake identities, deceptive accounts, access-control bypass, scraping against platform rules, or undisclosed automated communication.',
        userPrompt: JSON.stringify({
          task: '为以下商业主张生成待人工审核的多阶段求证策略，并输出 JSON。',
          subject: input.subject,
          claim: input.claim,
          sourceNote: input.sourceNote ?? null,
          mode: input.mode,
          requestedRoleIds: selectedRoleIds,
        }),
        schema: generatedPlanSchema,
        fallback: {
          missions: fallbackMissions.map((mission) => ({
            id: mission.id,
            objective: mission.objective,
            opening: mission.opening,
            followUp: mission.followUp,
            receipt: mission.receipt,
          })),
        },
      });
      const returnedIds = generated.value.missions.map((mission) => mission.id);
      const containsExactRoles =
        returnedIds.length === selectedRoleIds.length &&
        selectedRoleIds.every((roleId) => returnedIds.includes(roleId)) &&
        new Set(returnedIds).size === returnedIds.length;
      const passesPolicy = generatedPlanPassesPolicy(generated.value);

      if (containsExactRoles && passesPolicy) {
        const generatedByRole = new Map(
          generated.value.missions.map((mission) => [mission.id, mission]),
        );
        missions = fallbackMissions.map((mission) => ({
          ...mission,
          ...generatedByRole.get(mission.id),
          id: mission.id,
          code: mission.code,
          name: mission.name,
          perspective: mission.perspective,
          boundary: mission.boundary,
          status: 'planned',
        }));
      }
      planning = {
        engine: 'DEEPSEEK',
        mode:
          generated.provenance.mode === 'LIVE' &&
          (!containsExactRoles || !passesPolicy)
            ? 'DETERMINISTIC_FALLBACK'
            : generated.provenance.mode,
        model: generated.provenance.model,
        reason:
          generated.provenance.mode === 'LIVE' && !containsExactRoles
            ? 'INVALID_RESPONSE'
            : generated.provenance.mode === 'LIVE' && !passesPolicy
              ? 'POLICY_REJECTED'
              : generated.provenance.reason,
      };
    }

    const createdAt = now();
    const investigation: EvidenceOperationsInvestigation = {
      version: 2,
      id: randomUUID(),
      subject: input.subject,
      claim: input.claim,
      sourceNote: input.sourceNote,
      mode: input.mode,
      createdAt,
      updatedAt: createdAt,
      storage: {
        kind: 'VOLATILE_IN_MEMORY',
        warning: '原型服务重启后数据会丢失，不适合作为生产证据库。',
      },
      externalAccess: {
        state: 'NOT_CONFIGURED',
        detail: '没有美团、Google 或其他第三方连接器被调用。',
      },
      planning,
      missions,
      evidence: [],
      events: [],
    };
    this.recordEvent(investigation, {
      type: 'INVESTIGATION_CREATED',
      actor: 'SYSTEM',
      message: '调查草稿已创建；尚未执行任何外部动作。',
    });
    this.recordEvent(investigation, {
      type: 'PLAN_CREATED',
      actor: 'SYSTEM',
      message:
        planning.mode === 'LIVE'
          ? 'DeepSeek 已生成待审核策略；没有生成证据或结论。'
          : planning.mode === 'DETERMINISTIC_FALLBACK'
            ? planning.reason === 'POLICY_REJECTED' ||
              planning.reason === 'INVALID_RESPONSE'
              ? '模型结果未通过角色或安全校验，已使用本地策略模板。'
              : '模型未完成可用调用，已使用明确标注的本地策略模板。'
            : '已使用本地策略模板，未向模型发送调查内容。',
    });
    this.investigations.set(investigation.id, investigation);
    return investigation;
  }

  getInvestigation(id: string): EvidenceOperationsInvestigation {
    this.pruneExpiredInvestigations();
    const investigation = this.investigations.get(id);
    if (!investigation) {
      throw new NotFoundException('Evidence investigation not found');
    }
    return investigation;
  }

  prepareMission(
    investigationId: string,
    roleId: EvidenceRoleId,
  ): EvidenceOperationsInvestigation {
    const investigation = this.getInvestigation(investigationId);
    const mission = this.requireMission(investigation, roleId);
    if (mission.preparedAt) {
      return investigation;
    }
    mission.status = advanceStatus(mission.status, 'prepared');
    mission.preparedAt = now();
    this.recordEvent(investigation, {
      type: 'STRATEGY_PREPARED',
      actor: 'USER_CONFIRMED',
      roleId,
      message: '用户确认已在本地准备或复制策略；不代表已经发送。',
    });
    return investigation;
  }

  confirmContact(
    investigationId: string,
    roleId: EvidenceRoleId,
    channelLabel: string,
  ): EvidenceOperationsInvestigation {
    const investigation = this.getInvestigation(investigationId);
    if (investigation.mode === 'simulation_lab') {
      throw new ConflictException(
        'Simulation lab cannot record real external contact',
      );
    }
    const mission = this.requireMission(investigation, roleId);
    if (!mission.preparedAt) {
      throw new ConflictException(
        'Prepare the role strategy before confirming external contact',
      );
    }
    if (mission.contactedAt) {
      if (
        channelLabel &&
        mission.contactChannel &&
        channelLabel !== mission.contactChannel
      ) {
        throw new ConflictException(
          'Contact was already confirmed with a different channel',
        );
      }
      return investigation;
    }
    mission.status = advanceStatus(mission.status, 'contacted');
    mission.contactedAt = now();
    mission.contactChannel = channelLabel;
    this.recordEvent(investigation, {
      type: 'CONTACT_CONFIRMED',
      actor: 'USER_CONFIRMED',
      roleId,
      message: `用户确认已从授权渠道“${channelLabel}”执行；服务器没有代替用户发送。`,
    });
    return investigation;
  }

  addEvidence(
    investigationId: string,
    input: AddEvidenceReceiptInput,
  ): EvidenceOperationsInvestigation {
    const investigation = this.getInvestigation(investigationId);
    if (investigation.mode === 'simulation_lab') {
      throw new ConflictException(
        'Simulation lab cannot write to the real evidence ledger',
      );
    }
    const mission = this.requireMission(investigation, input.roleId);
    if (!mission.contactedAt) {
      throw new ConflictException(
        'Confirm the authorized external action before recording its receipt',
      );
    }
    const hashPayload = {
      roleId: input.roleId,
      sourceLabel: input.sourceLabel,
      sourceUrl: input.sourceUrl,
      capturedText: input.capturedText,
      stance: input.stance,
      capturedAt: input.capturedAt,
    };
    const contentHash = `sha256:${createHash('sha256')
      .update(JSON.stringify(hashPayload))
      .digest('hex')}`;
    const existing = investigation.evidence.find(
      (evidence) => evidence.id === input.id,
    );
    if (existing) {
      if (existing.contentHash !== contentHash) {
        throw new ConflictException(
          'Evidence id already exists with different content',
        );
      }
      return investigation;
    }
    if (
      investigation.evidence.length >=
      this.getPositiveConfig('MAX_RECEIPTS_PER_INVESTIGATION', 32)
    ) {
      throw new ConflictException(
        'Prototype receipt limit reached for this investigation',
      );
    }
    const recordedAt = now();
    investigation.evidence.push({
      ...input,
      recordedAt,
      contentHash,
      authorization: 'user_confirmed',
    });
    mission.status = 'evidence_received';
    this.recordEvent(investigation, {
      type: 'EVIDENCE_RECORDED',
      actor: 'USER_CONFIRMED',
      roleId: input.roleId,
      message:
        '用户提供的回执已写入原型账本并计算内容哈希；来源真实性仍待人工复核。',
    });
    return investigation;
  }

  private requireMission(
    investigation: EvidenceOperationsInvestigation,
    roleId: EvidenceRoleId,
  ): EvidenceRoleMission {
    const mission = investigation.missions.find(
      (candidate) => candidate.id === roleId,
    );
    if (!mission) {
      throw new NotFoundException('Evidence mission not found');
    }
    return mission;
  }

  private pruneExpiredInvestigations(): void {
    const cutoff =
      Date.now() -
      this.getPositiveConfig('INVESTIGATION_TTL_MS', 4 * 60 * 60 * 1000);
    for (const [id, investigation] of this.investigations) {
      if (Date.parse(investigation.createdAt) < cutoff) {
        this.investigations.delete(id);
      }
    }
    for (const [key, request] of this.completedCreateRequests) {
      if (!this.investigations.has(request.investigationId)) {
        this.completedCreateRequests.delete(key);
      }
    }
  }

  private getPositiveConfig(key: string, fallback: number): number {
    const parsed = Number.parseInt(
      this.configService.get<string>(key) ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private recordEvent(
    investigation: EvidenceOperationsInvestigation,
    event: Omit<EvidenceOperationEvent, 'id' | 'at'>,
  ): void {
    const at = now();
    investigation.events.push({
      id: randomUUID(),
      at,
      ...event,
    });
    investigation.updatedAt = at;
  }
}
