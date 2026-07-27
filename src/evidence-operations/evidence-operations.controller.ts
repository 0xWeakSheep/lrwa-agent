import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import {
  evidenceOperationModes,
  evidenceRoleIds,
  type EvidenceOperationsCapabilities,
  type EvidenceOperationsInvestigation,
} from './evidence-operations.types';
import { EvidenceOperationsService } from './evidence-operations.service';

const createInvestigationSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    subject: z.string().trim().min(1).max(160),
    claim: z.string().trim().min(1).max(1200),
    sourceNote: z.string().trim().max(500).optional(),
    mode: z.enum(evidenceOperationModes),
    roleIds: z.array(z.enum(evidenceRoleIds)).min(1).max(4),
    allowModelProcessing: z.boolean().default(false),
  })
  .strict()
  .refine((value) => value.mode !== 'authorized_connector', {
    message: 'Authorized connector mode is not configured',
    path: ['mode'],
  });

const roleParamSchema = z.enum(evidenceRoleIds);

const prepareSchema = z
  .object({
    userConfirmedCopy: z.literal(true),
  })
  .strict();

const contactSchema = z
  .object({
    userConfirmedExternalSend: z.literal(true),
    channelLabel: z.string().trim().min(1).max(120),
  })
  .strict();

const addEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    roleId: z.enum(evidenceRoleIds),
    sourceLabel: z.string().trim().min(1).max(240),
    sourceUrl: z
      .url()
      .max(2000)
      .refine(
        (value) => ['http:', 'https:'].includes(new URL(value).protocol),
        {
          message: 'Source URL must use http or https',
        },
      )
      .optional(),
    capturedText: z.string().trim().min(1).max(12_000),
    stance: z.enum(['supports', 'contradicts', 'context']),
    capturedAt: z.iso
      .datetime()
      .refine(
        (value) => Date.parse(value) <= Date.now() + 5 * 60 * 1000,
        'Capture time cannot be in the future',
      ),
    userConfirmedSource: z.literal(true),
  })
  .strict();

@Controller('evidence-operations')
export class EvidenceOperationsController {
  constructor(
    private readonly evidenceOperationsService: EvidenceOperationsService,
  ) {}

  @Get('capabilities')
  getCapabilities(): EvidenceOperationsCapabilities {
    return this.evidenceOperationsService.getCapabilities();
  }

  @Post('investigations')
  async createInvestigation(
    @Body() body: unknown,
  ): Promise<EvidenceOperationsInvestigation> {
    const parsed = createInvestigationSchema.safeParse(body);
    if (!parsed.success) {
      throw this.invalidRequest(
        'Invalid evidence investigation request',
        parsed.error,
      );
    }
    return this.evidenceOperationsService.createInvestigation(parsed.data);
  }

  @Get('investigations/:investigationId')
  getInvestigation(
    @Param('investigationId') investigationId: string,
  ): EvidenceOperationsInvestigation {
    return this.evidenceOperationsService.getInvestigation(investigationId);
  }

  @Post('investigations/:investigationId/missions/:roleId/prepare')
  prepareMission(
    @Param('investigationId') investigationId: string,
    @Param('roleId') roleIdParam: string,
    @Body() body: unknown,
  ): EvidenceOperationsInvestigation {
    const roleId = roleParamSchema.safeParse(roleIdParam);
    const confirmation = prepareSchema.safeParse(body);
    if (!roleId.success || !confirmation.success) {
      throw this.invalidRequest('Invalid strategy preparation confirmation', {
        role: roleId.success ? [] : roleId.error.issues,
        body: confirmation.success ? [] : confirmation.error.issues,
      });
    }
    return this.evidenceOperationsService.prepareMission(
      investigationId,
      roleId.data,
    );
  }

  @Post('investigations/:investigationId/missions/:roleId/contact')
  confirmContact(
    @Param('investigationId') investigationId: string,
    @Param('roleId') roleIdParam: string,
    @Body() body: unknown,
  ): EvidenceOperationsInvestigation {
    const roleId = roleParamSchema.safeParse(roleIdParam);
    const confirmation = contactSchema.safeParse(body);
    if (!roleId.success || !confirmation.success) {
      throw this.invalidRequest('Invalid external contact confirmation', {
        role: roleId.success ? [] : roleId.error.issues,
        body: confirmation.success ? [] : confirmation.error.issues,
      });
    }
    return this.evidenceOperationsService.confirmContact(
      investigationId,
      roleId.data,
      confirmation.data.channelLabel,
    );
  }

  @Post('investigations/:investigationId/evidence')
  addEvidence(
    @Param('investigationId') investigationId: string,
    @Body() body: unknown,
  ): EvidenceOperationsInvestigation {
    const parsed = addEvidenceSchema.safeParse(body);
    if (!parsed.success) {
      throw this.invalidRequest('Invalid evidence receipt', parsed.error);
    }
    return this.evidenceOperationsService.addEvidence(investigationId, {
      id: parsed.data.id,
      roleId: parsed.data.roleId,
      sourceLabel: parsed.data.sourceLabel,
      sourceUrl: parsed.data.sourceUrl,
      capturedText: parsed.data.capturedText,
      stance: parsed.data.stance,
      capturedAt: parsed.data.capturedAt,
    });
  }

  private invalidRequest(
    message: string,
    issues: unknown,
  ): BadRequestException {
    return new BadRequestException({ message, issues });
  }
}
