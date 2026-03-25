"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatYmdHmInUtcOffsetFromSqlite = exports.parseSqliteTimestampAsUtc = exports.formatYmdInUtcOffset = exports.UTC_PLUS_8_MINUTES = void 0;
const pad2 = (n) => String(n).padStart(2, '0');
exports.UTC_PLUS_8_MINUTES = 8 * 60;
const formatYmdInUtcOffset = (date = new Date(), offsetMinutes = exports.UTC_PLUS_8_MINUTES) => {
    const shifted = new Date(date.getTime() + offsetMinutes * 60000);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    return `${y}-${pad2(m)}-${pad2(d)}`;
};
exports.formatYmdInUtcOffset = formatYmdInUtcOffset;
const parseSqliteTimestampAsUtc = (value) => {
    const trimmed = value.trim();
    if (!trimmed)
        return new Date(NaN);
    if (trimmed.includes('T')) {
        return new Date(trimmed);
    }
    const iso = trimmed.replace(' ', 'T') + 'Z';
    return new Date(iso);
};
exports.parseSqliteTimestampAsUtc = parseSqliteTimestampAsUtc;
const formatYmdHmInUtcOffsetFromSqlite = (sqliteTimestamp, offsetMinutes = exports.UTC_PLUS_8_MINUTES) => {
    const utcDate = (0, exports.parseSqliteTimestampAsUtc)(sqliteTimestamp);
    const shifted = new Date(utcDate.getTime() + offsetMinutes * 60000);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    const hh = shifted.getUTCHours();
    const mm = shifted.getUTCMinutes();
    return `${y}-${pad2(m)}-${pad2(d)} ${pad2(hh)}:${pad2(mm)}`;
};
exports.formatYmdHmInUtcOffsetFromSqlite = formatYmdHmInUtcOffsetFromSqlite;
//# sourceMappingURL=time.js.map