import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({
  imports: [DatabaseModule, CatalogModule, AdminModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
