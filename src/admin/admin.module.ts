import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  AdminAuthController,
  AdminProductsController,
} from './admin.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminProductsService } from './admin-products.service.js';
import { sessionHash } from './password.js';
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'network', ttl: 60000, limit: 60 },
      {
        name: 'account',
        ttl: 60000,
        limit: 5,
        getTracker: (req) => {
          const email =
            typeof req.body?.email === 'string'
              ? req.body.email.trim().toLowerCase()
              : '';
          return String(req.ip) + ':' + sessionHash(email);
        },
      },
    ]),
  ],
  controllers: [AdminAuthController, AdminProductsController],
  providers: [AdminAuthService, AdminGuard, AdminProductsService],
})
export class AdminModule {}
