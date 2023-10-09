import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetItemDto } from './dto/get-item.dto';
import { CreateItemDto } from './dto/create-item.dto';

@Injectable()
export class ItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

// * storeId, user 정보에서 받아올 수 있게 수정
  async createItem(createItemDto: CreateItemDto): Promise<{ message: string }> {
    await this.prisma.items.create({
      data: {
        name: createItemDto.name,
        content: createItemDto.content,
        prevPrice: createItemDto.prevPrice,
        price: createItemDto.price,
        count: createItemDto.count,
        startTime: createItemDto.startTime,
        endTime: createItemDto.endTime,
        imgUrl: createItemDto.imgUrl,
        storeId: 1
      },
    });
    return { message: '핫딜 생성이 완료되었습니다.' };
  }

  async selectAllItems(itemId: number): Promise<GetItemDto[]> {
    const items: GetItemDto[] = await this.prisma.items.findMany({
      where: {
        itemId,
      },
      select: {
        name: true,
        content: true,
        prevPrice: true,
        price: true,
        count: true,
        startTime: true,
        endTime: true,
        imgUrl: true,
      },
    });

    return items;
  }
}
