"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weightRangeForBmi = exports.calculateBmi = void 0;
const calculateBmi = (weightKg, heightCm) => {
    const heightM = heightCm / 100;
    return weightKg / (heightM * heightM);
};
exports.calculateBmi = calculateBmi;
const weightRangeForBmi = (heightCm, bmiLow, bmiHigh) => {
    const heightM = heightCm / 100;
    return {
        lowKg: bmiLow * heightM * heightM,
        highKg: bmiHigh * heightM * heightM,
    };
};
exports.weightRangeForBmi = weightRangeForBmi;
//# sourceMappingURL=bmi.js.map