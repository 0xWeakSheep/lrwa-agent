import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const host = process.env.HOST?.trim() || '0.0.0.0';
  await app.listen(process.env.PORT ?? 3001, host);
}
void bootstrap();
