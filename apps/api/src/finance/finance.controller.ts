import { Controller, Get, Query } from '@nestjs/common';
import { FinanceService } from './finance.service';

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('balances')
  balances() {
    return this.finance.balances();
  }
  @Get('transactions')
  transactions(@Query('productId') productId?: string) {
    return this.finance.transactions(productId);
  }
  @Get('summary')
  summary() {
    return this.finance.summary();
  }
}
