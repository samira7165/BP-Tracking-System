import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminScriptsController, ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';
import { ScriptsStore } from './scripts.store';

@Module({
  imports: [AdminModule],
  controllers: [ScriptsController, AdminScriptsController],
  providers: [ScriptsStore, ScriptsService],
  exports: [ScriptsService],
})
export class ScriptsModule {}
