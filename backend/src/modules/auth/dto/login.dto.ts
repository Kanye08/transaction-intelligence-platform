import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ada@lagosfoods.ng' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;
}

export class OrganisationSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class UserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'OWNER' }) role!: string;
  @ApiProperty({ type: OrganisationSummaryDto }) organisation!: OrganisationSummaryDto;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT bearer token' }) accessToken!: string;
  @ApiProperty({ example: '12h' }) expiresIn!: string;
  @ApiProperty({ type: UserDto }) user!: UserDto;
}
