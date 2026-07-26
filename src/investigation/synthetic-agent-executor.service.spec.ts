import type { DemoCase, PlanTask } from '../domain/types';
import {
  createAgentTeam,
  createMorrowCase,
  deterministicId,
  verifyEvidenceHash,
} from './reality-twin';
import { SyntheticAgentExecutorService } from './synthetic-agent-executor.service';

describe('SyntheticAgentExecutorService', () => {
  const executor = new SyntheticAgentExecutorService();
  const seed = 'executor-test-seed';
  const demoCase = createMorrowCase(seed);
  const agents = createAgentTeam(seed).filter(
    (agent) => agent.role !== 'SUPERVISOR',
  );
  const fieldAgent = agents.find((agent) => agent.role === 'FIELD_OBSERVER')!;
  const task: PlanTask = {
    id: deterministicId('tsk', { seed, family: 'STORE_OBSERVATION' }),
    agentId: fieldAgent.id,
    evidenceFamily: 'STORE_OBSERVATION',
    objective: 'Execute a bounded synthetic storefront observation task.',
    sampleSize: 320,
    tool: 'visit-sampler',
  };

  it('executes one declared task through its allowed synthetic adapter', () => {
    const result = executor.executeTask({
      demoCase,
      investigationId: 'inv_executor_test',
      seed,
      agents,
      task,
    });

    expect(result.agent.role).toBe('FIELD_OBSERVER');
    expect(result.evidence.source.family).toBe('STORE_OBSERVATION');
    expect(result.evidence.source.label).toBe('SIMULATED');
    expect(result.evidence.sampleSize).toBe(320);
    expect(verifyEvidenceHash(result.evidence)).toBe(true);
    expect(result.policy).toMatchObject({
      boundary: 'SIMULATED_ONLY',
      toolAllowed: true,
      identityImpersonationAllowed: false,
      externalContactAllowed: false,
    });
    expect(result.policy.guardrailsApplied).toBeGreaterThan(0);
  });

  it('blocks a tool that is not allowed for the assigned agent', () => {
    expect(() =>
      executor.executeTask({
        demoCase,
        investigationId: 'inv_executor_test',
        seed,
        agents,
        task: { ...task, tool: 'synthetic-invoice-ledger' },
      }),
    ).toThrow('is not allowed');
  });

  it('blocks any case outside the explicit synthetic boundary', () => {
    const nonSyntheticCase = {
      ...demoCase,
      disclosure: 'OBSERVED',
    } as unknown as DemoCase;
    expect(() =>
      executor.executeTask({
        demoCase: nonSyntheticCase,
        investigationId: 'inv_executor_test',
        seed,
        agents,
        task,
      }),
    ).toThrow('only accepts SIMULATED cases');
  });

  it('blocks a task assigned to the wrong specialist role', () => {
    const supplyAgent = agents.find(
      (agent) => agent.role === 'SUPPLY_CHAIN_ANALYST',
    )!;
    expect(() =>
      executor.executeTask({
        demoCase,
        investigationId: 'inv_executor_test',
        seed,
        agents,
        task: {
          ...task,
          agentId: supplyAgent.id,
          tool: 'synthetic-invoice-ledger',
        },
      }),
    ).toThrow('cannot execute STORE_OBSERVATION');
  });
});
