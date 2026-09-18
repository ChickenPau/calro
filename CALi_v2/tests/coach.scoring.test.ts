import { scoreCoachRelevance } from '../src/services/coach.scoring';

const sampleQueries = [
  'How can I reduce calories without feeling hungry?',
  'What is a good protein target per day?',
  'Healthy fats examples for breakfast?',
  'How much water should I drink?',
  'Portion control tips for rice and noodles',
  'Should I eat carbs at night?',
  'Best snack with high protein and low calories',
  'How to increase fiber intake?',
  'Meal plan for weight loss and training',
  'Is olive oil a healthy fat?',
  'How to avoid overeating after work?',
  'What vegetables are best for micronutrients?',
  'How many steps should I aim for daily?',
  'Should I track macros or calories?',
  'How to build a balanced meal plate?',
  'What is the best post-workout meal?',
  'How to reduce sugary drinks?',
  'Is intermittent fasting safe?',
  'What is a good breakfast for fat loss?',
  'How do I handle cravings for snacks?',
  'Can I lose weight without exercise?',
  'What is a good dinner under 600 calories?',
  'How to get enough protein as a vegetarian?',
  'How to improve hydration habits?',
  'Are nuts good fats or too high calories?',
  'How much protein in chicken breast?',
  'How many carbs should runners eat?',
  'How to cut down on fried foods?',
  'What is a healthy portion size?',
  'How to keep energy stable during the day?',
  'Does sleep affect appetite?',
  'How can I eat more fruit without extra calories?',
  'What is a high fiber snack?',
  'How to plan meals to avoid takeout?',
  'What is a good lunch with protein and veggies?',
  'How to choose healthy fats for salads?',
  'How to reduce carbs without losing performance?',
  'How to stop late-night snacking?',
  'How many calories should I eat for fat loss?',
  'What is a good macro split?',
  'How to eat more whole foods?',
  'How to balance protein carbs fats per meal?',
  'Best hydration tips for hot weather?',
  'Are avocados healthy fats?',
  'How to increase protein at breakfast?',
  'How to reduce portion sizes gradually?',
  'Healthy snack ideas under 200 calories?',
  'How to include vegetables in every meal?',
  'How to keep carbs for training but lose weight?',
  'What is a good meal after a long run?',
];

describe('Coach relevance scoring', () => {
  it('scores >= 85% on 50 nutrition queries with a relevant reply', () => {
    for (const q of sampleQueries) {
      const reply = `Here are practical nutrition tips: focus on protein, carbs, and healthy fats, watch calories and portion size, add fiber, and improve hydration (water).`;
      const score = scoreCoachRelevance(q, reply);
      expect(score).toBeGreaterThanOrEqual(0.85);
    }
  });
});

