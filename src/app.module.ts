import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { EvidenceOperationsController } from './evidence-operations/evidence-operations.controller';
import { EvidenceOperationsService } from './evidence-operations/evidence-operations.service';
import {
  DEEPSEEK_FETCH,
  DeepSeekService,
  type FetchLike,
} from './llm/deepseek.service';

const nativeFetch: FetchLike = (input, init) => fetch(input, init);

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, EvidenceOperationsController],
  providers: [
    EvidenceOperationsService,
    DeepSeekService,
    { provide: DEEPSEEK_FETCH, useValue: nativeFetch },
  ],
})
export class AppModule {}
