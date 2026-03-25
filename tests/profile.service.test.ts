import { nutritionService } from '../src/services/nutrition.service';
import { databaseRepository } from '../src/repositories/database';

jest.mock('../src/services/ai.service', () => ({
  aiService: {
    analyzeFoodImage: jest.fn().mockResolvedValue({
      data: {
        food_name: 'Test Meal',
        calories: 400,
        protein_g: 25,
        carbs_g: 40,
        fats_g: 12,
        ai_tip: 'Tip',
      },
      rawResponse: '{"food_name":"Test Meal","calories":400,"protein_g":25,"carbs_g":40,"fats_g":12,"ai_tip":"Tip"}',
    }),
    getHealthyBmiRange: jest.fn().mockResolvedValue({
      bmi_low: 18.5,
      bmi_high: 24.9,
      rationale: 'WHO adult',
    }),
    coachChat: jest.fn().mockResolvedValue({
      reply: 'Coach reply',
      more: '',
      memory: 'mem',
    }),
  },
}));

describe('Profile flow', () => {
  const userId = Math.floor(Math.random() * 1000000);

  afterAll(() => {
    databaseRepository.close();
  });

  it('should save profile with BMI data', async () => {
    await nutritionService.registerUser(userId, 'u', 'First', 'Last');
    const profile = await nutritionService.setProfile(userId, 'Alice', 30, 'Female', 80, 170);

    expect(profile.display_name).toBe('Alice');
    expect(profile.age_years).toBe(30);
    expect(profile.sex).toBe('Female');
    expect(profile.bmi).toBeCloseTo(80 / (1.7 * 1.7));
    expect(profile.bmi_status).toBe('Obese');
    expect(profile.target_weight_low_kg).toBeCloseTo(18.5 * 1.7 * 1.7);
    expect(profile.target_weight_high_kg).toBeCloseTo(24.9 * 1.7 * 1.7);
  });

  it('should remove profile and delete entries', async () => {
    await nutritionService.processFoodPhoto(userId, 'fake', 'image/jpeg', 'desc', 'fileid');
    expect((await nutritionService.getHistory(userId)).length).toBeGreaterThan(0);

    nutritionService.removeProfileAndReset(userId);
    expect(nutritionService.getProfile(userId)).toBeNull();
    expect((await nutritionService.getHistory(userId)).length).toBe(0);
  });
});

