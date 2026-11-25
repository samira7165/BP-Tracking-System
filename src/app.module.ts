import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { DatabaseModule } from './database/database.module';
import { RecordingsModule } from './recordings/recordings.module';
import { SettingsModule } from './settings/settings.module';
import { ScriptsModule } from './scripts/scripts.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AdminModule, SettingsModule, ScriptsModule, RecordingsModule],
})
export class AppModule {}
