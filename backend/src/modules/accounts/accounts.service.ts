import { Injectable, NotFoundException } from '@nestjs/common';

import { AuthUser } from '../../common/auth/auth-user';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { AccountDto } from './dto/account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(user: AuthUser): Promise<AccountDto[]> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const accounts = await db.account.findMany({ orderBy: { name: 'asc' } });
    return accounts.map((account) => ({
      id: account.id,
      name: account.name,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      currency: account.currency,
    }));
  }

  async findOne(user: AuthUser, id: string): Promise<AccountDto> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const account = await db.account.findFirst({ where: { id } });
    // Another tenant's account is indistinguishable from one that never existed.
    if (!account) throw new NotFoundException('Account not found');
    return {
      id: account.id,
      name: account.name,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      currency: account.currency,
    };
  }
}
