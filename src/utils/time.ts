const pad2 = (n: number) => String(n).padStart(2, '0');

export const UTC_PLUS_8_MINUTES = 8 * 60;

export const formatYmdInUtcOffset = (date: Date = new Date(), offsetMinutes: number = UTC_PLUS_8_MINUTES): string => {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

export const parseSqliteTimestampAsUtc = (value: string): Date => {
  const trimmed = value.trim();
  if (!trimmed) return new Date(NaN);

  if (trimmed.includes('T')) {
    return new Date(trimmed);
  }

  const iso = trimmed.replace(' ', 'T') + 'Z';
  return new Date(iso);
};

export const formatYmdHmInUtcOffsetFromSqlite = (
  sqliteTimestamp: string,
  offsetMinutes: number = UTC_PLUS_8_MINUTES
): string => {
  const utcDate = parseSqliteTimestampAsUtc(sqliteTimestamp);
  const shifted = new Date(utcDate.getTime() + offsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const hh = shifted.getUTCHours();
  const mm = shifted.getUTCMinutes();
  return `${y}-${pad2(m)}-${pad2(d)} ${pad2(hh)}:${pad2(mm)}`;
};

