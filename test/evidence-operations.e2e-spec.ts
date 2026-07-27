import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type {
  EvidenceOperationsCapabilities,
  EvidenceOperationsInvestigation,
} from './../src/evidence-operations/evidence-operations.types';
import {
  DeepSeekService,
  type DeepSeekJsonRequest,
  type DeepSeekJsonResult,
} from './../src/llm/deepseek.service';

const noKeyDeepSeek = {
  generateJson<T>(
    input: DeepSeekJsonRequest<T>,
  ): Promise<DeepSeekJsonResult<T>> {
    return Promise.resolve({
      value: input.fallback,
      provenance: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        mode: 'DETERMINISTIC_FALLBACK',
        operation: input.operation,
        attempts: 0,
        reason: 'NO_API_KEY',
      },
    });
  },
};

describe('LRWA evidence operations API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DeepSeekService)
      .useValue(noKeyDeepSeek)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('keeps plans, user-confirmed actions and receipts truthfully separate', async () => {
    const capabilities = await request(app.getHttpServer())
      .get('/v1/evidence-operations/capabilities')
      .expect(200);
    const capabilitiesBody =
      capabilities.body as unknown as EvidenceOperationsCapabilities;
    expect(capabilitiesBody).toMatchObject({
      service: 'evidence-operations',
      storage: { state: 'VOLATILE_IN_MEMORY', durable: false },
    });
    expect(capabilitiesBody.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'meituan_partner',
          state: 'NOT_CONFIGURED',
        }),
        expect.objectContaining({
          id: 'google_places',
          state: 'NOT_CONFIGURED',
        }),
      ]),
    );

    const createInput = {
      idempotencyKey: '32370e17-e0c3-4268-aae6-a8190e69534f',
      subject: '测试品牌',
      claim: '公开门店均在正常营业',
      mode: 'assisted_live',
      roleIds: ['buyer', 'skeptic'],
      allowModelProcessing: true,
    };
    const created = await request(app.getHttpServer())
      .post('/v1/evidence-operations/investigations')
      .send(createInput)
      .expect(201);
    const createdBody =
      created.body as unknown as EvidenceOperationsInvestigation;
    expect(createdBody.missions).toHaveLength(2);
    expect(
      createdBody.missions.every((item) => item.status === 'planned'),
    ).toBe(true);
    expect(createdBody.evidence).toEqual([]);
    expect(createdBody.externalAccess.state).toBe('NOT_CONFIGURED');
    expect(createdBody.planning).toMatchObject({
      engine: 'DEEPSEEK',
      mode: 'DETERMINISTIC_FALLBACK',
      reason: 'NO_API_KEY',
    });
    expect(createdBody.events.map((event) => event.type)).toEqual([
      'INVESTIGATION_CREATED',
      'PLAN_CREATED',
    ]);
    expect(JSON.stringify(createdBody)).not.toMatch(
      /COMPLETED|HIGH|estimatedValue|totalProbes/,
    );

    const repeatedCreate = await request(app.getHttpServer())
      .post('/v1/evidence-operations/investigations')
      .send(createInput)
      .expect(201);
    expect(
      (repeatedCreate.body as unknown as EvidenceOperationsInvestigation).id,
    ).toBe(createdBody.id);

    await request(app.getHttpServer())
      .post('/v1/evidence-operations/investigations')
      .send({ ...createInput, claim: '同一幂等键下的另一项主张' })
      .expect(409);

    const investigationId = createdBody.id;
    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/missions/buyer/contact`,
      )
      .send({
        userConfirmedExternalSend: true,
        channelLabel: '官方客服',
      })
      .expect(409);

    const prepared = await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/missions/buyer/prepare`,
      )
      .send({ userConfirmedCopy: true })
      .expect(201);
    const preparedBody =
      prepared.body as unknown as EvidenceOperationsInvestigation;
    expect(preparedBody.missions[0]).toMatchObject({
      id: 'buyer',
      status: 'prepared',
    });

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/missions/buyer/contact`,
      )
      .send({
        userConfirmedExternalSend: false,
        channelLabel: '官方客服',
      })
      .expect(400);

    const contacted = await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/missions/buyer/contact`,
      )
      .send({
        userConfirmedExternalSend: true,
        channelLabel: '官方客服',
      })
      .expect(201);
    const contactedBody =
      contacted.body as unknown as EvidenceOperationsInvestigation;
    expect(contactedBody.missions[0]).toMatchObject({
      status: 'contacted',
      contactChannel: '官方客服',
    });

    const receiptId = '168cc278-3f3d-47c8-bbc0-0af8e8fc8ea2';
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    const receiptInput = {
      id: receiptId,
      roleId: 'buyer',
      sourceLabel: '用户提供的客服会话',
      sourceUrl: 'https://example.com/receipt',
      capturedText: '客服表示需要按具体门店与时段查询。',
      stance: 'context',
      capturedAt,
      userConfirmedSource: true,
    };

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send({
        ...receiptInput,
        id: '49cdd1bb-c555-4563-b97d-259f2efcb074',
        sourceUrl: 'javascript:alert(1)',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send({
        ...receiptInput,
        id: '8c0951e6-7ed1-4ea0-b894-73621b9e483d',
        capturedAt: '2100-01-01T00:00:00.000Z',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send({
        ...receiptInput,
        roleId: 'skeptic',
        id: 'ecf3c995-d8ae-4b28-a922-e786bbf6af9c',
      })
      .expect(409);

    const recorded = await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send(receiptInput)
      .expect(201);
    const recordedBody =
      recorded.body as unknown as EvidenceOperationsInvestigation;
    expect(recordedBody.evidence).toHaveLength(1);
    expect(recordedBody.evidence[0]).toMatchObject({
      id: receiptId,
      authorization: 'user_confirmed',
    });
    expect(recordedBody.evidence[0].contentHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(recordedBody.missions[0].status).toBe('evidence_received');
    expect(recordedBody.events.at(-1)).toMatchObject({
      type: 'EVIDENCE_RECORDED',
      actor: 'USER_CONFIRMED',
    });

    const repeated = await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send(receiptInput)
      .expect(201);
    const repeatedBody =
      repeated.body as unknown as EvidenceOperationsInvestigation;
    expect(repeatedBody.evidence).toHaveLength(1);

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send({
        ...receiptInput,
        capturedText: '相同 ID 不得被替换为另一段内容。',
      })
      .expect(409);
  });

  it('blocks real-contact semantics inside the simulation lab', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/evidence-operations/investigations')
      .send({
        idempotencyKey: 'ba9c1fcb-6081-4d8a-89d5-c528a794523f',
        subject: '方法演示',
        claim: '用于展示工作流',
        mode: 'simulation_lab',
        roleIds: ['competitor'],
        allowModelProcessing: false,
      })
      .expect(201);

    const createdBody =
      created.body as unknown as EvidenceOperationsInvestigation;
    const investigationId = createdBody.id;
    expect(createdBody.planning).toEqual({
      engine: 'LOCAL_TEMPLATE',
      mode: 'NOT_REQUESTED',
    });

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/missions/competitor/contact`,
      )
      .send({
        userConfirmedExternalSend: true,
        channelLabel: '公开页面观察',
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(
        `/v1/evidence-operations/investigations/${investigationId}/evidence`,
      )
      .send({
        id: '169d290e-7e1e-4f45-ab04-92596de99594',
        roleId: 'competitor',
        sourceLabel: '模拟内容',
        capturedText: '不应进入真实账本',
        stance: 'context',
        capturedAt: new Date(Date.now() - 60_000).toISOString(),
        userConfirmedSource: true,
      })
      .expect(409);

    const unchanged = await request(app.getHttpServer())
      .get(`/v1/evidence-operations/investigations/${investigationId}`)
      .expect(200);
    const unchangedBody =
      unchanged.body as unknown as EvidenceOperationsInvestigation;
    expect(unchangedBody.evidence).toEqual([]);
    expect(unchangedBody.missions[0].status).toBe('planned');
  });

  it('rejects connector mode until an authorized connector exists', async () => {
    await request(app.getHttpServer())
      .post('/v1/evidence-operations/investigations')
      .send({
        idempotencyKey: 'cd698f69-985d-43df-901d-d881e15e6657',
        subject: '连接器检查',
        claim: '不应假装连接器可用',
        mode: 'authorized_connector',
        roleIds: ['buyer'],
        allowModelProcessing: false,
      })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
