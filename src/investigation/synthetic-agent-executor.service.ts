import { ConflictException, Injectable } from '@nestjs/common';
import type {
  AgentDefinition,
  DemoCase,
  Evidence,
  PlanTask,
} from '../domain/types';
import { generateEvidenceForTask, verifyEvidenceHash } from './reality-twin';

export interface SyntheticAgentExecution {
  agent: AgentDefinition;
  task: PlanTask;
  evidence: Evidence;
  policy: {
    boundary: 'SIMULATED_ONLY';
    toolAllowed: true;
    guardrailsApplied: number;
    identityImpersonationAllowed: false;
    externalContactAllowed: false;
  };
}

export interface ExecuteSyntheticTaskInput {
  demoCase: DemoCase;
  investigationId: string;
  seed: string;
  agents: AgentDefinition[];
  task: PlanTask;
  corporateOrderShare?: number;
}

@Injectable()
export class SyntheticAgentExecutorService {
  executeTask(input: ExecuteSyntheticTaskInput): SyntheticAgentExecution {
    if (input.demoCase.disclosure !== 'SIMULATED') {
      throw new ConflictException(
        'Synthetic executor only accepts SIMULATED cases',
      );
    }
    const agent = input.agents.find(
      (candidate) => candidate.id === input.task.agentId,
    );
    if (!agent) {
      throw new ConflictException(
        `Task ${input.task.id} references an unknown agent`,
      );
    }
    if (!agent.allowedTools.includes(input.task.tool)) {
      throw new ConflictException(
        `Tool ${input.task.tool} is not allowed for ${agent.role}`,
      );
    }
    if (agent.guardrails.length === 0) {
      throw new ConflictException(
        `Agent ${agent.role} has no declared guardrails`,
      );
    }

    let evidence: Evidence;
    try {
      evidence = generateEvidenceForTask(
        input.demoCase,
        input.investigationId,
        input.seed,
        input.agents,
        input.task,
        input.corporateOrderShare ?? 0,
      );
    } catch (error: unknown) {
      throw new ConflictException(
        error instanceof Error ? error.message : 'Synthetic task failed',
      );
    }

    if (
      evidence.source.label !== 'SIMULATED' ||
      evidence.source.family !== input.task.evidenceFamily ||
      evidence.agent.id !== agent.id ||
      evidence.agent.role !== agent.role ||
      evidence.tool !== input.task.tool ||
      evidence.sampleSize !== input.task.sampleSize ||
      !verifyEvidenceHash(evidence)
    ) {
      throw new ConflictException(
        `Task ${input.task.id} returned an invalid evidence receipt`,
      );
    }

    return {
      agent,
      task: input.task,
      evidence,
      policy: {
        boundary: 'SIMULATED_ONLY',
        toolAllowed: true,
        guardrailsApplied: agent.guardrails.length,
        identityImpersonationAllowed: false,
        externalContactAllowed: false,
      },
    };
  }
}
