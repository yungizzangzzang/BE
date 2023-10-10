import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { IsOptional, Matches, MaxLength, MinLength } from 'class-validator';
import { UserEntity } from 'src/users/entities/user.entity';

export class UpdateUserDto extends PartialType(UserEntity) {
  @IsOptional()
  @MinLength(2, { message: '2자 이상을 입력해주세요' })
  @MaxLength(6, { message: '6자 이하를 입력해주세요' })
  @ApiProperty({ type: String, description: '닉네임', example: 'nickname' })
  nickname?: string | undefined;

  @IsOptional()
  @MinLength(8, { message: '8자이상을 입력해주세요' })
  @MaxLength(20, { message: '20자 이하를 입력해주세요' })
  @Matches(/^[a-zA-Z0-9]*$/, {
    message: '비밀번호를 영어와 숫자로만 만들어주세요 ',
  })
  @ApiProperty({
    type: String,
    description: '비밀번호',
    example: '1q2w3e4r',
  })
  password?: string;
}