import { TZDate } from '@date-fns/tz';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiError';

/**
 * Port local time helpers (spec 0003). Trips are stored as UTC instants; every conversion
 * between an instant and a port's local wall time or local day goes through this file.
 * Nothing here falls back to a default zone: callers always pass the port's `timeZone`.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

export const NONEXISTENT_LOCAL_TIME_MESSAGE =
  'This local time does not exist at the port on that day';

/** True when `timeZone` is a zone name this runtime can use (IANA names and their links). */
export const isValidTimeZone = (timeZone: unknown): timeZone is string => {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

export const assertValidTimeZone = (timeZone: unknown): string => {
  if (!isValidTimeZone(timeZone)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid time zone: ${String(timeZone)}`);
  }
  return timeZone;
};

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** The wall clock reading of `instant` at `timeZone`. */
const wallPartsAt = (instant: Date, timeZone: string): WallParts => {
  assertValidTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
};

const sameWall = (a: WallParts, b: WallParts) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute;

const pad = (n: number) => String(n).padStart(2, '0');

/** The port local calendar date (`YYYY-MM-DD`) of `instant`. */
export const localDate = (instant: Date, timeZone: string): string => {
  const p = wallPartsAt(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/**
 * The instant a local wall time (`YYYY-MM-DDTHH:mm[:ss[.sss]]`) happens at `timeZone`.
 * A time skipped by a daylight saving jump is rejected (400); a time that happens twice
 * resolves to its first (earlier) occurrence.
 */
export const wallTimeToInstant = (wall: string, timeZone: string): Date => {
  assertValidTimeZone(timeZone);
  const m = WALL_TIME.exec(wall);
  if (!m) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid local date time: ${wall}`);
  }
  const [year, month, day, hour, minute, second = '0', ms = '0'] = m.slice(1);
  const wanted: WallParts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };

  let instant = new Date(
    new TZDate(
      wanted.year,
      wanted.month - 1,
      wanted.day,
      wanted.hour,
      wanted.minute,
      Number(second),
      Number(ms.padEnd(3, '0')),
      timeZone,
    ).getTime(),
  );

  // Converting back must give the typed wall time; otherwise the clock skipped it.
  if (!sameWall(wallPartsAt(instant, timeZone), wanted)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, NONEXISTENT_LOCAL_TIME_MESSAGE);
  }

  // A repeated wall time (clocks fall back) keeps its earlier occurrence.
  for (const shiftMs of [60 * 60 * 1000, 30 * 60 * 1000]) {
    const earlier = new Date(instant.getTime() - shiftMs);
    if (sameWall(wallPartsAt(earlier, timeZone), wanted)) {
      instant = earlier;
      break;
    }
  }

  return instant;
};

/** First instant of the local day after the start of `year-month-day` (normalises overflow). */
const startOfLocalDay = (year: number, month: number, day: number, timeZone: string): Date =>
  new Date(new TZDate(year, month - 1, day, 0, 0, 0, 0, timeZone).getTime());

/** UTC instants bounding the port local day `ymd` (`YYYY-MM-DD`): start inclusive, end inclusive. */
export const localDayBounds = (ymd: string, timeZone: string): { start: Date; end: Date } => {
  // A missing zone would silently fall back to the server's own zone; refuse instead.
  assertValidTimeZone(timeZone);
  const m = YMD.exec(ymd);
  if (!m) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid date: ${ymd}`);
  }
  const [year, month, day] = m.slice(1).map(Number);
  const start = startOfLocalDay(year, month, day, timeZone);
  const nextStart = startOfLocalDay(year, month, day + 1, timeZone);
  return { start, end: new Date(nextStart.getTime() - 1) };
};

/**
 * A schedule time from the API: an exact instant when it carries `Z` or an offset,
 * otherwise a local wall time at `timeZone`. A date with no time is rejected.
 */
export const parseScheduleTime = (input: string | Date, timeZone: string): Date => {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid date time');
    }
    return input;
  }
  const value = input.trim();
  if (HAS_ZONE.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime()) || !value.includes('T')) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid date time: ${value}`);
    }
    return instant;
  }
  return wallTimeToInstant(value, timeZone);
};

/** `hh:mm AM` at the port, the same shape trip search has always returned. */
export const formatLocalTime = (instant: Date, timeZone: string): string =>
  instant.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: assertValidTimeZone(timeZone),
  });

/** Today's date (`YYYY-MM-DD`) at the port. */
export const portToday = (timeZone: string, now: Date = new Date()): string =>
  localDate(now, timeZone);
