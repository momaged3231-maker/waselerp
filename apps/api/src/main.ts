import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: process.env.FRONTEND_URL ?? true,
      credentials: true,
    },
    bodyParser: false,
  });

  app.use(express.json({ limit: 50 * 1024 * 1024 }));
  app.use(express.urlencoded({ extended: true, limit: 50 * 1024 * 1024 }));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`WaselERP API listening on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
