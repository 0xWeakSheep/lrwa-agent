import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type {
  DemoCase,
  Evidence,
  Finding,
  Investigation,
} from './../src/domain/types';
import type { DemoCaseBundle } from './../src/investigation/investigation.service';

describe('LRWA demo API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('runs the no-key happy path and exposes replayable SSE', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/demo/cases')
      .send({ seed: 'e2e-morrow' })
      .expect(201);
    const createdBody = created.body as unknown as DemoCaseBundle;
    const caseId = createdBody.case.id;
    const investigationId = createdBody.investigation.id;

    const caseResponse = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .expect(200);
    const caseBody = caseResponse.body as unknown as DemoCase;
    expect(caseBody.disclosure).toBe('SIMULATED');
    expect(caseBody.company.brandName).toContain('晨潮咖啡');
    expect(caseBody.stores).toHaveLength(48);
    expect(caseBody.claims.map((claim) => claim.reportedValue)).toEqual([
      48, 118, 19.6, 3_330_000,
    ]);

    const planned = await request(app.getHttpServer())
      .post(`/v1/investigations/${investigationId}/plan`)
      .expect(201);
    const plannedBody = planned.body as unknown as Investigation;
    expect(plannedBody.status).toBe('PLANNED');
    expect(plannedBody.plan?.tasks).toHaveLength(5);
    expect(plannedBody.plan?.totalProbes).toBe(1024);
    expect(
      plannedBody.plan?.tasks.reduce((sum, task) => sum + task.sampleSize, 0),
    ).toBe(1024);

    const approved = await request(app.getHttpServer())
      .post(`/v1/investigations/${investigationId}/approve`)
      .expect(201);
    const approvedBody = approved.body as unknown as Investigation;
    expect(approvedBody.status).toBe('APPROVED');

    const started = await request(app.getHttpServer())
      .post(`/v1/investigations/${investigationId}/start`)
      .expect(201);
    const startedBody = started.body as unknown as Investigation;
    expect(startedBody.status).toBe('COMPLETED');
    expect(startedBody.summary?.overallRisk).toBe('HIGH');

    const evidenceResponse = await request(app.getHttpServer())
      .get(`/v1/investigations/${investigationId}/evidence`)
      .expect(200);
    const evidence = evidenceResponse.body as unknown as Evidence[];
    expect(evidence).toHaveLength(5);
    expect(
      evidence.every(
        (item) => item.source.label === 'SIMULATED' && item.hash.length === 64,
      ),
    ).toBe(true);

    const findingsResponse = await request(app.getHttpServer())
      .get(`/v1/investigations/${investigationId}/findings`)
      .expect(200);
    const findings = findingsResponse.body as unknown as Finding[];
    expect(findings).toHaveLength(4);
    expect(
      findings.every(
        (finding) => finding.independentEvidenceFamilies.length >= 2,
      ),
    ).toBe(true);
    const baseGmv = findings.find(
      (finding) => finding.reportedValue === 3_330_000,
    );
    expect(baseGmv).toMatchObject({
      verdict: 'UNSUPPORTED',
      estimatedValue: 1_920_000,
      lowerBound: 1_720_000,
      upperBound: 2_140_000,
      gapPercent: 42.3,
      confidence: 0.88,
    });

    await request(app.getHttpServer())
      .get(`/v1/investigations/${investigationId}/events`)
      .expect('Content-Type', /text\/event-stream/)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('INVESTIGATION_COMPLETED');
        expect(text).toContain('HYPOTHESIS_RAISED');
        expect(text).toContain('SKEPTIC');
        expect(text).toContain('SIMULATED');
      });

    const replayed = await request(app.getHttpServer())
      .post(`/v1/investigations/${investigationId}/replay`)
      .send({ corporateOrderShare: 0.2 })
      .expect(201);
    const replayedBody = replayed.body as unknown as Investigation;
    expect(replayedBody.replayOf).toBe(investigationId);
    expect(replayedBody.status).toBe('COMPLETED');

    const replayFindingsResponse = await request(app.getHttpServer())
      .get(`/v1/investigations/${replayedBody.id}/findings`)
      .expect(200);
    const replayFindings = replayFindingsResponse.body as unknown as Finding[];
    const replayGmv = replayFindings.find(
      (finding) => finding.reportedValue === 3_330_000,
    );
    expect(replayGmv?.estimatedValue).toBe(2_400_000);
    expect(replayGmv?.gapPercent).toBeLessThan(baseGmv?.gapPercent ?? 0);
    expect(replayGmv?.confidence).toBeLessThan(baseGmv?.confidence ?? 0);
    expect(replayGmv?.verdict).toBe('UNSUPPORTED');

    await request(app.getHttpServer())
      .get(`/v1/investigations/${replayedBody.id}/events`)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('REPLAY_STARTED');
        expect(text).toContain('"humanApproved":true');
        expect(text).toContain('"corporateOrderShare":0.2');
      });

    const repeated = await request(app.getHttpServer())
      .post(`/v1/investigations/${investigationId}/replay`)
      .send({ corporateOrderShare: 0.2 })
      .expect(201);
    const repeatedBody = repeated.body as unknown as Investigation;
    expect(repeatedBody.id).toBe(replayedBody.id);

    await request(app.getHttpServer())
      .post(`/v1/investigations/${investigationId}/replay`)
      .send({ corporateOrderShare: 0.8 })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
