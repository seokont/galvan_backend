import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminGuard, type AdminRequest } from './admin.guard.js';
import { AdminProductsService, productId } from './admin-products.service.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
  ) {}
  @Post('login')
  @UseGuards(ThrottlerGuard)
  login(@Body() body: unknown) {
    return this.auth.login(body);
  }
  @Get('session')
  @UseGuards(AdminGuard)
  session(@Req() req: AdminRequest) {
    return req.admin;
  }
  @Post('logout')
  @UseGuards(AdminGuard)
  logout(@Req() req: AdminRequest) {
    return this.auth.logout(req.headers.authorization);
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminProductsController {
  constructor(
    @Inject(AdminProductsService)
    private readonly products: AdminProductsService,
  ) {}
  @Get('products') list(@Query() query: Record<string, unknown>) {
    return this.products.list(query);
  }
  @Get('metadata') metadata() {
    return this.products.metadata();
  }
  @Get('products/:id') detail(@Param('id') id: string) {
    return this.products.get(productId(id));
  }
  @Patch('products/:id') save(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AdminRequest,
  ) {
    return this.products.save(productId(id), body, req.admin.id);
  }
  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AdminRequest,
  ) {
    return this.products.upload(file, req.admin.id);
  }
  @Get('images/:filename')
  @Header('Cache-Control', 'private, no-store')
  async image(@Param('filename') filename: string) {
    await this.products.imageExists(filename);
    const file = resolve(
      process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
      'images',
      filename,
    );
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new NotFoundException('Photo not found');
    }
    const ext = filename.split('.').at(-1);
    return new StreamableFile(createReadStream(file), {
      type: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext,
      length: info.size,
      disposition: 'inline',
    });
  }
}
