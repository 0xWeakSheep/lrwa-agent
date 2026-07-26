import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHealth(): {
    service: string;
    status: 'ok';
    mode: 'SIMULATED';
    apiVersion: 'v1';
  } {
    return {
      service: 'LRWA — Live Real-World Assurance / 现实验证引擎',
      status: 'ok',
      mode: 'SIMULATED',
      apiVersion: 'v1',
    };
  }
}
