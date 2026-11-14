import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';

const server = express();
let initialized = false;

async function bootstrap() {
  if (initialized) return;
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    cors: {
      origin: process.env.FRONTEND_URL ?? true,
      credentials: true,
    },
    bodyParser: false,
  });
  app.use(express.json({ limit: 50 * 1024 * 1024 }));
  app.use(express.urlencoded({ extended: true, limit: 50 * 1024 * 1024 }));
  app.setGlobalPrefix('api');
  await app.init();
  initialized = true;
}

export default async function handler(req: any, res: any) {
  await bootstrap();
  server(req, res);
}
