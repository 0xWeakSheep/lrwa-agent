import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';

describe('LRWA API boundary (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('advertises only the evidence-operations prototype', async () => {
    await request(app.getHttpServer()).get('/v1').expect(200).expect({
      service: 'LRWA — Live Real-World Assurance / 现实验证引擎',
      status: 'ok',
      mode: 'EVIDENCE_OPERATIONS_PROTOTYPE',
      apiVersion: 'v1',
    });

    await request(app.getHttpServer()).post('/v1/demo/cases').expect(404);
  });

  it('does not grant browser access to an unconfigured origin', async () => {
    const localResponse = await request(app.getHttpServer())
      .get('/v1')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(localResponse.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );

    const unknownResponse = await request(app.getHttpServer())
      .get('/v1')
      .set('Origin', 'https://unconfigured.example')
      .expect(200);
    expect(
      unknownResponse.headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
