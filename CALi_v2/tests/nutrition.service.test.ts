import { nutritionService } from '../src/services/nutrition.service';
import { databaseRepository } from '../src/repositories/database';
import { nutritionRepository } from '../src/repositories/nutrition.repository';

// Mock AI Service to avoid actual API calls
jest.mock('../src/services/ai.service', () => ({
  aiService: {
    analyzeFoodImage: jest.fn().mockResolvedValue({
      data: {
        food_name: 'Healthy Chicken Salad',
        calories: 500,
        protein_g: 30,
        carbs_g: 50,
        fats_g: 20,
        ai_tip: 'Great meal for runners!',
      },
      rawResponse: '{"food_name": "Healthy Chicken Salad", "calories": 500, "protein_g": 30, "carbs_g": 50, "fats_g": 20, "ai_tip": "Great meal for runners!"}',
    }),
  },
}));

describe('NutritionService', () => {
  const testUserId = Math.floor(Math.random() * 1000000);

  beforeAll(async () => {
    // Database is automatically initialized
    await nutritionService.registerUser(testUserId, 'testrunner', 'Test', 'Runner');
  });

  afterAll(() => {
    databaseRepository.close();
  });

  it('should process a food photo correctly', async () => {
    const result = await nutritionService.processFoodPhoto(testUserId, 'fake-base64', 'image/jpeg');

    expect(result.data.calories).toBe(500);
    expect(result.data.protein_g).toBe(30);
    
    const stats = await nutritionService.getDailyStats(testUserId);
    expect(stats).toBeDefined();
    expect(stats?.total_calories).toBe(500);
    expect(stats?.entry_count).toBe(1);
  });

  it('should calculate macro percentages correctly', async () => {
    const stats = await nutritionService.getDailyStats(testUserId);
    expect(stats?.proteinPct).toBeCloseTo(30 / (30 + 50 + 20) * 100);
    expect(stats?.carbsPct).toBeCloseTo(50 / (30 + 50 + 20) * 100);
    expect(stats?.fatsPct).toBeCloseTo(20 / (30 + 50 + 20) * 100);
  });

  it('should export CSV content', async () => {
    const csv = await nutritionService.exportCSV(testUserId);
    expect(csv).toContain('Calories');
    expect(csv).toContain('500');
    expect(csv).toContain('Great meal for runners!');
  });
});
