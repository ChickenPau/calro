export const calculateBmi = (weightKg: number, heightCm: number): number => {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
};

export const weightRangeForBmi = (
  heightCm: number,
  bmiLow: number,
  bmiHigh: number
): { lowKg: number; highKg: number } => {
  const heightM = heightCm / 100;
  return {
    lowKg: bmiLow * heightM * heightM,
    highKg: bmiHigh * heightM * heightM,
  };
};

