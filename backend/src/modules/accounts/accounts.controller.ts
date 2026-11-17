import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AccountsService } from './accounts.service';
import { AccountDto } from './dto/account.dto';

@ApiTags('accounts')
@ApiBearerAuth('bearer')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List the financial accounts of the caller organisation' })
  @ApiOkResponse({ type: [AccountDto] })
  list(@CurrentUser() user: AuthUser): Promise<AccountDto[]> {
    return this.accounts.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve one account' })
  @ApiOkResponse({ type: AccountDto })
  @ApiNotFoundResponse({ description: 'No such account in this organisation' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AccountDto> {
    return this.accounts.findOne(user, id);
  }
}
