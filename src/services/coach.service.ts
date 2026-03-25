import { coachRepository } from '@/repositories/coach.repository';
import { nutritionService } from '@/services/nutrition.service';
import { aiService } from '@/services/ai.service';

const chunkText = (text: string, chunkSize: number): string[] => {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
};

export class CoachService {
  public async ask(telegram_id: number, userMessage: string): Promise<{ reply: string; hasMore: boolean }> {
    const state = coachRepository.getState(telegram_id);
    const profile = nutritionService.getProfile(telegram_id) || undefined;

    const result = await aiService.coachChat({
      userMessage,
      memory: state.memory,
      profile: profile
        ? {
            display_name: profile.display_name,
            age_years: profile.age_years,
            sex: profile.sex,
            bmi: profile.bmi,
            bmi_status: profile.bmi_status,
            weight_kg: profile.weight_kg,
            target_weight_low_kg: profile.target_weight_low_kg,
            target_weight_high_kg: profile.target_weight_high_kg,
          }
        : undefined,
    });

    const pending = result.more ? chunkText(result.more, 900) : [];
    coachRepository.setState({ telegram_id, memory: result.memory, pending_chunks: pending });

    return { reply: result.reply, hasMore: pending.length > 0 };
  }

  public next(telegram_id: number): { chunk: string | null; hasMore: boolean } {
    const state = coachRepository.getState(telegram_id);
    const next = state.pending_chunks.shift();
    coachRepository.setState({ telegram_id, memory: state.memory, pending_chunks: state.pending_chunks });
    return { chunk: next || null, hasMore: state.pending_chunks.length > 0 };
  }

  public clear(telegram_id: number) {
    coachRepository.clearState(telegram_id);
  }
}

export const coachService = new CoachService();
export default coachService;

