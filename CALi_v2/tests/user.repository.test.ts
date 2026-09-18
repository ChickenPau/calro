import { userRepository } from '../src/repositories/user.repository';
import { databaseRepository } from '../src/repositories/database';

describe('UserRepository', () => {
  beforeAll(() => {
    // Database is automatically initialized by the repository
  });

  afterAll(() => {
    databaseRepository.close();
  });

  it('should upsert a user correctly', () => {
    const testUser = {
      telegram_id: 123456,
      username: 'testuser',
      first_name: 'Test',
      last_name: 'User',
    };

    userRepository.upsertUser(testUser);
    const user = userRepository.getUser(123456);

    expect(user).toBeDefined();
    expect(user?.telegram_id).toBe(123456);
    expect(user?.username).toBe('testuser');
    expect(user?.first_name).toBe('Test');
  });

  it('should update timezone', () => {
    userRepository.updateTimezone(123456, 'Asia/Shanghai');
    const user = userRepository.getUser(123456);
    expect(user?.timezone).toBe('Asia/Shanghai');
  });
});
