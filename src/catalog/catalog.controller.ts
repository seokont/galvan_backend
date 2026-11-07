import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Get('products')
  list(@Query() query: Record<string, unknown>) {
    return this.catalog.list(query);
  }

  @Get('facets')
  facets() {
    return this.catalog.facets();
  }

  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.catalog.detail(slug);
  }

  @Get('images/:filename')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(@Param('filename') filename: string) {
    await this.catalog.imageExists(filename);
    const file = resolve(
      process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
      'images',
      filename,
    );
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new NotFoundException('Image not found');
    }
    const ext = filename.split('.').at(-1);
    const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return new StreamableFile(createReadStream(file), {
      type,
      length: info.size,
      disposition: 'inline',
    });
  }
}
