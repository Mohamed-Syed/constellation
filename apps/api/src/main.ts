import "reflect-metadata";
import { ValidationPipe, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const prefix = process.env.API_GLOBAL_PREFIX ?? "api";
  app.setGlobalPrefix(prefix);

  // --- Security headers (OWASP baseline) ---
  app.use(helmet());

  // --- CORS: only the configured portal origins ---
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  // --- Strict input validation everywhere ---
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableShutdownHooks();

  // --- OpenAPI / Swagger ---
  const config = new DocumentBuilder()
    .setTitle("Constellation Platform API")
    .setDescription("Core platform API: auth, RBAC, plugin management, admin.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Constellation API listening on http://localhost:${port}/${prefix}`, "Bootstrap");
  Logger.log(`OpenAPI docs at http://localhost:${port}/${prefix}/docs`, "Bootstrap");
}

void bootstrap();
