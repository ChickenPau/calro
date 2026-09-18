"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coachRepository = exports.CoachRepository = void 0;
const database_1 = require("./database");
class CoachRepository {
    constructor() {
        this.db = database_1.databaseRepository.getDb();
    }
    getState(telegram_id) {
        const row = this.db
            .prepare('SELECT telegram_id, memory, pending_chunks FROM coach_state WHERE telegram_id = ?')
            .get(telegram_id);
        if (!row) {
            return { telegram_id, memory: '', pending_chunks: [] };
        }
        let pending = [];
        try {
            pending = row.pending_chunks ? JSON.parse(row.pending_chunks) : [];
        }
        catch {
            pending = [];
        }
        return {
            telegram_id,
            memory: row.memory || '',
            pending_chunks: Array.isArray(pending) ? pending : [],
        };
    }
    setState(state) {
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
    clearState(telegram_id) {
        this.db.prepare('DELETE FROM coach_state WHERE telegram_id = ?').run(telegram_id);
    }
}
exports.CoachRepository = CoachRepository;
exports.coachRepository = new CoachRepository();
exports.default = exports.coachRepository;
//# sourceMappingURL=coach.repository.js.map