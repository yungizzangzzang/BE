import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOrderOrderItemDto } from './dto/create-order.dto';
import { OneOrderDTO } from './dto/get-one-order.dto';
import { UserOrdersDTO } from './dto/get-user-orders.dto';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  private readonly userRedis: Redis;
  private readonly itemRedis: Redis;
  private readonly storeRedis: Redis;
  private readonly createOrderStream: Redis;
  private readonly updateItemStream: Redis;
  private readonly updateUserPointStream: Redis;

  // Redis 인스턴스 생성을 위한 공통 함수
  private createRedisClient(port: number): Redis {
    const client = new Redis({ port, host: process.env.REDIS_HOST });
    client.on('error', (err) => {
      console.error(`Redis error on port ${port}:`, err);
    });
    return client;
  }
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly prisma: PrismaService,
  ) {
    // 공통 함수를 사용하여 Redis 클라이언트 초기화
    this.userRedis = this.createRedisClient(7001);
    this.itemRedis = this.createRedisClient(7002);
    this.storeRedis = this.createRedisClient(7003);
    this.createOrderStream = this.createRedisClient(7004);
    this.updateItemStream = this.createRedisClient(7005);
    this.updateUserPointStream = this.createRedisClient(7006);
  }

  async updateRedisUserPoint(
    userId: number,
    totalPrice: number,
  ): Promise<{ newPoint: number; version: number }> {
    let version = 0;

    // userId로 redis에서 포인트 조회 {userId: point} -> userId: {point: number, version: number}
    const getRedisPoint = await this.userRedis.hgetall(userId.toString());
    let redisPoint =
      getRedisPoint && getRedisPoint.point ? parseInt(getRedisPoint.point) : -1;

    // redis에 user 정보 없을 때 DB 조회
    if (redisPoint === -1) {
      const user = await this.prisma.users.findUnique({
        where: { userId },
        select: { point: true, version: true },
      });

      if (!user || !user.point) {
        throw new HttpException(
          { message: '사용자 정보를 확인할 수 없습니다.' },
          HttpStatus.BAD_REQUEST,
        );
      }

      version = user.version ?? 0;
      redisPoint = user.point;

      await this.userRedis.hmset(
        userId.toString(),
        'point',
        redisPoint.toString(),
        'version',
        version.toString(),
      );
    } else {
      const redisVersion = await this.userRedis.hget(
        userId.toString(),
        'version',
      );
      version = parseInt(redisVersion ?? '0');

      if (isNaN(version)) {
        throw new HttpException(
          { message: '사용자 버전 정보를 확인할 수 없습니다.' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    // redisPoint < totalPrice
    if (redisPoint < totalPrice) {
      throw new HttpException(
        { message: '포인트를 충전해주세요.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 포인트 차감
    await this.userRedis.hincrby(userId.toString(), 'point', -totalPrice);
    // 버전 정보 저장
    version++;
    await this.userRedis.hset(userId.toString(), 'version', version.toString());

    return { newPoint: redisPoint - totalPrice, version };
  }

  // 아이템 수량 및 버전 관리
  async updateItemCount(
    itemId: number,
    countToDeduct: number,
  ): Promise<{ newCount: number; version: number }> {
    let version = 0;

    // itemId로 redis에서 아이템 수량과 버전 조회 {itemId: {count: number, version: number}}
    const getRedisItemData = await this.itemRedis.hgetall(itemId.toString());
    let itemCount =
      getRedisItemData && getRedisItemData.count
        ? parseInt(getRedisItemData.count)
        : -1;

    // redis에 아이템 정보가 없을 때 DB 조회
    if (itemCount === -1) {
      const item = await this.prisma.items.findUnique({
        where: { itemId },
        select: { count: true, version: true },
      });

      if (!item || item.count === null) {
        throw new BadRequestException('아이템의 수량 정보를 찾을 수 없습니다.');
      }

      version = item.version ?? 0;
      itemCount = item.count;

      await this.itemRedis.hmset(
        itemId.toString(),
        'count',
        itemCount.toString(),
        'version',
        version.toString(),
      );
    } else {
      const redisVersion = await this.itemRedis.hget(
        itemId.toString(),
        'version',
      );
      version = parseInt(redisVersion ?? '0');

      if (isNaN(version)) {
        throw new InternalServerErrorException(
          '아이템 버전 정보를 확인할 수 없습니다.',
        );
      }
    }

    // 아이템 수량 검증
    if (itemCount < countToDeduct) {
      throw new BadRequestException('아이템의 수량이 부족합니다.');
    }

    // 아이템 수량 차감
    await this.itemRedis.hincrby(itemId.toString(), 'count', -countToDeduct);
    // 버전 정보 증가 및 저장
    version++;
    await this.itemRedis.hset(itemId.toString(), 'version', version.toString());

    return { newCount: itemCount - countToDeduct, version };
  }

  async validateStoreExistence(storeId: number): Promise<void> {
    let storeExists = await this.storeRedis.get(storeId.toString());

    if (storeExists === null) {
      const storeRecord = await this.prisma.stores.findUnique({
        where: { storeId },
        select: { storeId: true },
      });

      storeExists = storeRecord ? '1' : '0';
      await this.storeRedis.set(storeId.toString(), storeExists);
    }

    if (storeExists === '0') {
      throw new NotFoundException('해당 가게를 찾을 수 없습니다.');
    }
  }

  async createOrder(
    createOrderOrderItemDto: CreateOrderOrderItemDto,
    userId: number,
  ) {
    try {
      // 스토어 존재 여부 검증
      await this.validateStoreExistence(createOrderOrderItemDto.storeId);

      // 포인트 감소 처리 및 버전++
      const { newPoint, version } = await this.updateRedisUserPoint(
        userId,
        createOrderOrderItemDto.totalPrice,
      );

      // 포인트 감소 처리 결과를 스트림에 추가
      await this.updateUserPointStream.xadd(
        'updateUserPointStream',
        '*',
        'userId',
        userId.toString(),
        'remainUserPoint',
        newPoint.toString(),
        'version',
        version.toString(),
      );

      // 아이템 수량 감소 및 버전++
      const updateItemsResults: {
        itemId: number;
        newCount: number;
        version: number;
      }[] = [];
      for (const item of createOrderOrderItemDto.items) {
        const updateResult = await this.updateItemCount(
          item.itemId,
          item.count,
        );

        updateItemsResults.push({
          itemId: item.itemId,
          newCount: updateResult.newCount,
          version: updateResult.version,
        });

        // 아이템 수량 감소 및 버전 관리 처리 결과를 스트림에 추가
        await this.updateItemStream.xadd(
          'updateItemCountStream',
          '*',
          'itemId',
          item.itemId.toString(),
          'count',
          item.count.toString(),
          'version',
          updateResult.version.toString(),
        );
      }

      // Order, OrderItem 생성하는 정보를 스트림에 추가
      await this.createOrderStream.xadd(
        'createOrderStream',
        '*',
        'userId',
        userId.toString(),
        'details',
        JSON.stringify(createOrderOrderItemDto),
      );

      // // 스트림에서 메시지 조회
      // const userPointsStreamMessages =
      //   await this.updateUserPointStream.xrevrange(
      //     'updateUserPointStream',
      //     '+',
      //     '-',
      //     'COUNT',
      //     '1',
      //   );
      // console.log('User Points Stream Messages:', userPointsStreamMessages);

      // const itemCountsStreamMessages = await this.updateItemStream.xrange(
      //   'itemCountsStream',
      //   '-',
      //   '+',
      //   'COUNT',
      //   '1',
      // );
      // console.log('Item Counts Stream Messages:', itemCountsStreamMessages);

      // const ordersStreamMessages = await this.createOrderStream.xrange(
      //   'createOrdersStream',
      //   '-',
      //   '+',
      //   'COUNT',
      //   '1',
      // );
      // console.log('Orders Stream Messages:', ordersStreamMessages);

      return { message: '주문에 성공하였습니다.' };
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async getUserOrders(userId: number) {
    const result: UserOrdersDTO[] = await this.ordersRepository.getUserOrders(
      userId,
    );
    return result;
  }

  async getOneOrder(orderId: number) {
    const result: OneOrderDTO = await this.ordersRepository.getOneOrder(
      orderId,
    );
    return result;
  }
}
