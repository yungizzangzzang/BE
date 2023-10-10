import { Injectable } from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { ResponseReviewDto } from './dto/response-review.dto';
import { ReviewsRepository } from './reviews.reopository';

@Injectable()
export class ReviewsService {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}
  async createReview(
    userId: number,
    storeId: number,
    createReviewDto: CreateReviewDto,
  ) {
    const { content, star } = createReviewDto;
    const result: { message: string } =
      await this.reviewsRepository.createReview(userId, storeId, content, star);

    return result;
  }

  async getStoreReview(storeId: number) {
    const result: ResponseReviewDto[] =
      await this.reviewsRepository.getStoreReview(storeId);

    return result;
  }
}