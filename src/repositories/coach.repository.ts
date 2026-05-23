import { Database } from 'better-sqlite3';
import { databaseRepository } from './database';

export interface CoachState {
  telegram_id: number;
  memory: string;
  pending_chunks: string[];
}

export class CoachRepository {
  private db: Database;

  constructor() {
    this.db = databaseRepository.getDb();
  }

  public getState(telegram_id: number): CoachState {
    const row = this.db
      .prepare('SELECT telegram_id, memory, pending_chunks FROM coach_state WHERE telegram_id = ?')
      .get(telegram_id) as { telegram_id: number; memory: string | null; pending_chunks: string | null } | undefined;

    if (!row) {
      return { telegram_id, memory: '', pending_chunks: [] };
    }

    let pending: string[] = [];
    try {
      pending = row.pending_chunks ? (JSON.parse(row.pending_chunks) as string[]) : [];
    } catch {
      pending = [];
    }

    return {
      telegram_id,
      memory: row.memory || '',
      pending_chunks: Array.isArray(pending) ? pending : [],
    };
  }

  public setState(state: CoachState): void {
    const stmt = this.db.prepare(`
      INSERT INTO coach_state (telegram_id, memory, pending_chunks, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id) DO UPDATE SET
        memory = excluded.memory,
        pending_chunks = excluded.pending_chunks,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(state.telegram_id, state.memory, JSON.stringify(state.pending_chunks || []));
  }

  public clearState(telegram_id: number): void {
    this.db.prepare('DELETE FROM coach_state WHERE telegram_id = ?').run(telegram_id);
  }

  public recordCoachInput(telegram_id: number, date: string): void {
    this.db
      .prepare(`INSERT INTO coach_inputs (telegram_id, entry_date) VALUES (?, ?)`)
      .run(telegram_id, date);
  }

  public getCoachInputCountToday(telegram_id: number, date: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM coach_inputs WHERE telegram_id = ? AND entry_date = ?`)
      .get(telegram_id, date) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}

export const coachRepository = new CoachRepository();
export default coachRepository;

