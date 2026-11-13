import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.slice';
import { SalesController, PurchasesController, SalesService } from './sales.slice';
import { DocumentsService, QuotationsController, OrdersController, ShipmentsController } from './documents.slice';
import { PosService, PosController } from './pos.slice';

/**
 * The sales slice owns the whole commercial cycle: invoices, quotations and
 * orders. The module lives in its own file so the quotation/order services
 * can reuse the invoice engine without a circular import.
 */
@Module({
  imports: [EventsModule],
  controllers: [SalesController, PurchasesController, QuotationsController, OrdersController, ShipmentsController, PosController],
  providers: [SalesService, DocumentsService, PosService],
  exports: [SalesService],
})
export class SalesModule {}
