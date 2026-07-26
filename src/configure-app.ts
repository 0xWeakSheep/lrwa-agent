import type { INestApplication } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  app.setGlobalPrefix('v1');
}
