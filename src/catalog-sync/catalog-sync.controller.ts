import {
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, type AdminRequest } from '../admin/admin.guard.js';
import { CatalogSyncService } from './catalog-sync.service.js';
@Controller('admin/catalog-sync')
@UseGuards(AdminGuard)
export class CatalogSyncController {
  constructor(
    @Inject(CatalogSyncService) private readonly sync: CatalogSyncService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  latest() {
    return this.sync.latest();
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  start(@Req() request: AdminRequest) {
    return this.sync.start(request.admin.id);
  }
}
