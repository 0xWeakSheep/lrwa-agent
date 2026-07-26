import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { InvestigationController } from './investigation/investigation.controller';
import { InvestigationService } from './investigation/investigation.service';
import { SyntheticAgentExecutorService } from './investigation/synthetic-agent-executor.service';
import {
  DEEPSEEK_FETCH,
  DeepSeekService,
  type FetchLike,
} from './llm/deepseek.service';

const nativeFetch: FetchLike = (input, init) => fetch(input, init);

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, InvestigationController],
  providers: [
    InvestigationService,
    SyntheticAgentExecutorService,
    DeepSeekService,
    { provide: DEEPSEEK_FETCH, useValue: nativeFetch },
  ],
})
export class AppModule {}
