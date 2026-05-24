import { coachRepository } from '../src/repositories/coach.repository';
import { userRepository } from '../src/repositories/user.repository';
import { databaseRepository } from '../src/repositories/database';

describe('CoachRepository — daily coach input tracking', () => {
  const TEST_USER_ID = 987654;
  const TEST_DATE = '2099-01-15';

  beforeAll(() => {
    userRepository.upsertUser({
      telegram_id: TEST_USER_ID,
      username: 'coachquota',
      first_name: 'Coach',
      last_name: 'Quota',
    });
  });

  afterAll(() => {
    const db = databaseRepository.getDb();
    db.prepare('DELETE FROM coach_inputs WHERE telegram_id = ?').run(TEST_USER_ID);
    databaseRepository.close();
  });

  it('starts with zero coach inputs for the day', () => {
    expect(coachRepository.getCoachInputCountToday(TEST_USER_ID, TEST_DATE)).toBe(0);
  });

  it('increments the per-day counter on each recorded input', () => {
    coachRepository.recordCoachInput(TEST_USER_ID, TEST_DATE);
    coachRepository.recordCoachInput(TEST_USER_ID, TEST_DATE);
    coachRepository.recordCoachInput(TEST_USER_ID, TEST_DATE);
    expect(coachRepository.getCoachInputCountToday(TEST_USER_ID, TEST_DATE)).toBe(3);
  });

  it('keeps counters isolated per calendar day', () => {
    coachRepository.recordCoachInput(TEST_USER_ID, '2099-01-16');
    expect(coachRepository.getCoachInputCountToday(TEST_USER_ID, TEST_DATE)).toBe(3);
    expect(coachRepository.getCoachInputCountToday(TEST_USER_ID, '2099-01-16')).toBe(1);
  });
});
