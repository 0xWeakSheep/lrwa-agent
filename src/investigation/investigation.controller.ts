import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { from, map, type Observable } from 'rxjs';
import { z } from 'zod';
import type {
  DemoCase,
  Evidence,
  Finding,
  Investigation,
} from '../domain/types';
import {
  type DemoCaseBundle,
  InvestigationService,
} from './investigation.service';

const demoRequestSchema = z
  .object({
    seed: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const replayRequestSchema = z
  .object({
    corporateOrderShare: z.number().min(0).max(0.5).default(0),
  })
  .strict();

@Controller()
export class InvestigationController {
  constructor(private readonly investigationService: InvestigationService) {}

  @Post('demo/cases')
  createDemoCase(@Body() body: unknown): DemoCaseBundle {
    const parsed = demoRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid demo case request',
        issues: parsed.error.issues,
      });
    }
    return this.investigationService.createDemoCase(parsed.data.seed);
  }

  @Get('cases/:caseId')
  getCase(@Param('caseId') caseId: string): DemoCase {
    return this.investigationService.getCase(caseId);
  }

  @Post('investigations/:investigationId/plan')
  proposePlan(
    @Param('investigationId') investigationId: string,
  ): Investigation {
    return this.investigationService.proposePlan(investigationId);
  }

  @Post('investigations/:investigationId/approve')
  approvePlan(
    @Param('investigationId') investigationId: string,
  ): Investigation {
    return this.investigationService.approvePlan(investigationId);
  }

  @Post('investigations/:investigationId/start')
  startInvestigation(
    @Param('investigationId') investigationId: string,
  ): Investigation {
    return this.investigationService.startInvestigation(investigationId);
  }

  @Post('investigations/:investigationId/replay')
  replayInvestigation(
    @Param('investigationId') investigationId: string,
    @Body() body: unknown,
  ): Investigation {
    const parsed = replayRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid replay hypothesis',
        issues: parsed.error.issues,
      });
    }
    return this.investigationService.replayInvestigation(
      investigationId,
      parsed.data.corporateOrderShare,
    );
  }

  @Get('investigations/:investigationId')
  getInvestigation(
    @Param('investigationId') investigationId: string,
  ): Investigation {
    return this.investigationService.getInvestigation(investigationId);
  }

  @Get('investigations/:investigationId/evidence')
  getEvidence(@Param('investigationId') investigationId: string): Evidence[] {
    return this.investigationService.getEvidence(investigationId);
  }

  @Get('investigations/:investigationId/findings')
  getFindings(@Param('investigationId') investigationId: string): Finding[] {
    return this.investigationService.getFindings(investigationId);
  }

  @Sse('investigations/:investigationId/events')
  streamEvents(
    @Param('investigationId') investigationId: string,
  ): Observable<MessageEvent> {
    return from(this.investigationService.getEvents(investigationId)).pipe(
      map((event) => ({
        id: event.id,
        type: event.type,
        data: event,
      })),
    );
  }
}
