import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ensureDirs } from './common/paths';

async function bootstrap() {
  ensureDirs();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // The default of 100 KB is too small for a long Bangla script (3 bytes per letter)
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  // Serves the recording page (/) and the admin dashboard (/admin) from /public
  app.useStaticAssets(join(process.cwd(), 'public'), { extensions: ['html'] });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`Recording page:  http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Admin dashboard: http://localhost:${port}/admin`, 'Bootstrap');

  if (!process.env.ADMIN_PASSWORD) {
    Logger.warn('ADMIN_PASSWORD is not set. Add it to .env or nobody can log in to /admin.', 'Bootstrap');
  }
}
bootstrap();
