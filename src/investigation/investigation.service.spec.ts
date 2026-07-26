import { ConflictException } from '@nestjs/common';
import type { DeepSeekJsonRequest } from '../llm/deepseek.service';
import { DeepSeekService } from '../llm/deepseek.service';
import { InvestigationService } from './investigation.service';
import { SyntheticAgentExecutorService } from './synthetic-agent-executor.service';

function deterministicDeepSeek(): DeepSeekService {
  return {
    generateJson: jest.fn(<T>(request: DeepSeekJsonRequest<T>) =>
      Promise.resolve({
        value: request.fallback,
        provenance: {
          provider: 'deepseek' as const,
          model: 'deepseek-v4-flash',
          mode: 'DETERMINISTIC_FALLBACK' as const,
          operation: request.operation,
          attempts: 0,
          reason: 'NO_API_KEY' as const,
        },
      }),
    ),
  } as unknown as DeepSeekService;
}

describe('InvestigationService task preflight', () => {
  it('keeps an approved investigation retryable when an adapter is blocked', async () => {
    const executor = new SyntheticAgentExecutorService();
    const service = new InvestigationService(deterministicDeepSeek(), executor);
    const { investigation } = service.createDemoCase('blocked-preflight');
    await service.proposePlan(investigation.id);
    service.approvePlan(investigation.id);
    const eventCountBeforeStart = service.getEvents(investigation.id).length;

    jest.spyOn(executor, 'executeTask').mockImplementationOnce(() => {
      throw new ConflictException('Synthetic adapter blocked');
    });

    await expect(service.startInvestigation(investigation.id)).rejects.toThrow(
      'Synthetic adapter blocked',
    );
    const current = service.getInvestigation(investigation.id);
    expect(current.status).toBe('APPROVED');
    expect(current.startedAt).toBeUndefined();
    expect(service.getEvidence(investigation.id)).toEqual([]);
    expect(service.getEvents(investigation.id)).toHaveLength(
      eventCountBeforeStart,
    );
  });
});
