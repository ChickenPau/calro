import { calculateBmi, weightRangeForBmi } from '../src/utils/bmi';

describe('BMI utils', () => {
  it('calculates BMI accurately', () => {
    const bmi = calculateBmi(80, 170);
    expect(bmi).toBeCloseTo(80 / (1.7 * 1.7));
  });

  it('calculates weight range for BMI bounds', () => {
    const range = weightRangeForBmi(170, 18.5, 24.9);
    expect(range.lowKg).toBeCloseTo(18.5 * 1.7 * 1.7);
    expect(range.highKg).toBeCloseTo(24.9 * 1.7 * 1.7);
  });
});

