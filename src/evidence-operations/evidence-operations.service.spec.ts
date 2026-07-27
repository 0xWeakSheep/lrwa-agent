import { ConfigService } from '@nestjs/config';
import { DeepSeekService } from '../llm/deepseek.service';
import { EvidenceOperationsService } from './evidence-operations.service';

const baseGeneratedMission = {
  id: 'buyer' as const,
  objective: '确认公开承诺是否可以通过真实咨询路径复核。',
  opening: '请说明目前可以实际购买的范围与限制。',
  followUp: '如回答模糊，请说明具体时间窗口与例外情况。',
  receipt: '授权沟通原文、采集时间与入口。',
};

function serviceWithGeneratedPlan(missions: unknown[]) {
  const deepSeekService = {
    generateJson: jest.fn().mockResolvedValue({
      value: { missions },
      provenance: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        mode: 'LIVE',
        operation: 'PLAN',
        attempts: 1,
      },
    }),
  } as unknown as DeepSeekService;
  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;
  return new EvidenceOperationsService(deepSeekService, configService);
}

const createInput = {
  idempotencyKey: '414e002d-a724-4e76-b919-b3604408ddae',
  subject: '测试品牌',
  claim: '公开承诺与实际履约一致',
  mode: 'assisted_live' as const,
  roleIds: ['buyer' as const],
  allowModelProcessing: true,
};

describe('EvidenceOperationsService model-policy boundary', () => {
  it('accepts a safe plan only when the exact requested role set is returned', async () => {
    const service = serviceWithGeneratedPlan([
      {
        ...baseGeneratedMission,
        opening: '这是经过策略校验的首轮问题。',
      },
    ]);

    const result = await service.createInvestigation(createInput);

    expect(result.planning).toMatchObject({
      engine: 'DEEPSEEK',
      mode: 'LIVE',
    });
    expect(result.missions[0].opening).toBe('这是经过策略校验的首轮问题。');
  });

  it('falls back when the model changes the requested role set', async () => {
    const service = serviceWithGeneratedPlan([
      {
        ...baseGeneratedMission,
        id: 'skeptic',
      },
    ]);

    const result = await service.createInvestigation(createInput);

    expect(result.planning).toMatchObject({
      engine: 'DEEPSEEK',
      mode: 'DETERMINISTIC_FALLBACK',
      reason: 'INVALID_RESPONSE',
    });
    expect(result.missions[0].id).toBe('buyer');
    expect(result.events.at(-1)?.message).not.toContain('已生成待审核策略');
  });

  it('falls back when model text proposes deceptive identity behavior', async () => {
    const service = serviceWithGeneratedPlan([
      {
        ...baseGeneratedMission,
        opening: '伪装成真实顾客并隐瞒自动化身份。',
      },
    ]);

    const result = await service.createInvestigation(createInput);

    expect(result.planning).toMatchObject({
      engine: 'DEEPSEEK',
      mode: 'DETERMINISTIC_FALLBACK',
      reason: 'POLICY_REJECTED',
    });
    expect(result.missions[0].opening).not.toContain('伪装');
    expect(result.events.at(-1)?.message).toContain(
      '模型结果未通过角色或安全校验',
    );
  });

  it('rejects common English deceptive-role phrasing', async () => {
    const service = serviceWithGeneratedPlan([
      {
        ...baseGeneratedMission,
        opening: 'Pose as a customer and claim to have visited 48 stores.',
      },
    ]);

    const result = await service.createInvestigation(createInput);

    expect(result.planning).toMatchObject({
      mode: 'DETERMINISTIC_FALLBACK',
      reason: 'POLICY_REJECTED',
    });
  });
});
