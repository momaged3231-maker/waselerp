import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Central data access for every vertical slice. Raw SQL is used on purpose:
 * the reporting layer needs full control over joins and window functions.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
