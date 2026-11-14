import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from './common/database/database.module';
import { JwtAuthGuard, PermissionsGuard } from './common/security';
import { AuthModule } from './modules/auth/auth.slice';
import { CatalogModule } from './modules/catalog/catalog.slice';
import { ItemsModule } from './modules/catalog/items.slice';
import { PartiesModule } from './modules/parties/parties.slice';
import { CustomerGroupsModule } from './modules/parties/customer-group.slice';
import { HrModule } from './modules/hr/hr.slice';
import { RemindersModule } from './modules/reminders/reminders.slice';
import { SalesModule } from './modules/sales/sales.module';
import { InventoryModule } from './modules/inventory/inventory.slice';
import { TreasuryModule } from './modules/treasury/treasury.slice';
import { ReportsModule } from './modules/reports/reports.slice';
import { EventsModule } from './modules/events/events.slice';
import { InstallmentsModule } from './modules/installments/installments.slice';
import { ZatcaModule } from './modules/zatca/zatca.slice';
import { AdminModule } from './modules/admin/admin.slice';
import { AccountingModule } from './modules/accounting/accounting.slice';
import { PricingModule } from './modules/pricing/pricing.slice';
import { EtaModule } from './modules/eta/eta.slice';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'wasel-dev-secret-change-me',
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES') ?? '15m' },
      }),
    }),
    DatabaseModule,
    AuthModule,
    CatalogModule,
    ItemsModule,
    PartiesModule,
    CustomerGroupsModule,
    HrModule,
    RemindersModule,
    SalesModule,
    InventoryModule,
    TreasuryModule,
    ReportsModule,
    EventsModule,
    InstallmentsModule,
    ZatcaModule,
    AdminModule,
    AccountingModule,
    PricingModule,
    EtaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
