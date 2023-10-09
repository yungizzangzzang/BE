import { PickType } from '@nestjs/mapped-types';
import { ItemEntity } from '../entities/item.entity';

export class UpdateItemDto extends PickType(ItemEntity, [
  'name',
  'content',
  'prevPrice',
  'price',
  'count',
  'startTime',
  'entTime',
  'imgUrl',
] as const) {}