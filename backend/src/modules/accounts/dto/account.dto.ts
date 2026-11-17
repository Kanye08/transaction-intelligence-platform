import { ApiProperty } from '@nestjs/swagger';

export class AccountDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Operations Current Account' }) name!: string;
  @ApiProperty({ example: 'GTBank' }) bankName!: string;
  @ApiProperty({ example: '0123456789' }) accountNumber!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}
