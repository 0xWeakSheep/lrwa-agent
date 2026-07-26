import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { InvestigationController } from './investigation/investigation.controller';
import { InvestigationService } from './investigation/investigation.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, InvestigationController],
  providers: [InvestigationService],
})
export class AppModule {}
