import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminGuard } from '../admin/admin.guard.js';
import { EnquiriesService } from './enquiries.service.js';
@Controller('enquiries')
export class PublicEnquiriesController {
  constructor(
    @Inject(EnquiriesService) private readonly enquiries: EnquiriesService,
  ) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ account: true })
  // Shared proxy-peer safety ceiling; persistent per-email limits live in the service.
  @Throttle({ network: { limit: 300, ttl: 60000 } })
  create(@Body() body: unknown) {
    return this.enquiries.create(body);
  }
}
@Controller('admin/enquiries')
@UseGuards(AdminGuard)
export class AdminEnquiriesController {
  constructor(
    @Inject(EnquiriesService) private readonly enquiries: EnquiriesService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: Record<string, unknown>) {
    return this.enquiries.list(query);
  }
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.enquiries.update(id, body);
  }
}
