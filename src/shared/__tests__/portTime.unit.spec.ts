import { describe, expect, it } from 'vitest';
import {
  NONEXISTENT_LOCAL_TIME_MESSAGE,
  assertValidTimeZone,
  formatLocalTime,
  isValidTimeZone,
  localDate,
  localDayBounds,
  parseScheduleTime,
  portToday,
  wallTimeToInstant,
} from '../portTime';

const AST_PORTS = [
  'America/Anguilla',
  'America/Marigot',
  'America/Lower_Princes',
  'America/Kralendijk',
  'America/St_Kitts',
];

describe('portTime (spec 0003)', () => {
  it('runs in a zone far from the ports, so server zone leaks would show', () => {
    expect(process.env.TZ).toBe('Asia/Dhaka');
  });

  describe('time zone validation', () => {
    it.each(AST_PORTS)('accepts the backfilled zone %s', zone => {
      expect(isValidTimeZone(zone)).toBe(true);
    });

    it('rejects unknown or empty names with 400', () => {
      expect(isValidTimeZone('Mars/Olympus')).toBe(false);
      expect(isValidTimeZone('')).toBe(false);
      expect(() => assertValidTimeZone('Mars/Olympus')).toThrow(/Invalid time zone/);
    });

    it('never falls back to the server zone when a zone is missing', () => {
      const missing = undefined as unknown as string;
      expect(() => localDayBounds('2026-11-06', missing)).toThrow(/Invalid time zone/);
      expect(() => formatLocalTime(new Date(), missing)).toThrow(/Invalid time zone/);
      expect(() => localDate(new Date(), missing)).toThrow(/Invalid time zone/);
    });
  });

  describe('localDayBounds', () => {
    it('spans the port local day, not the UTC day', () => {
      const { start, end } = localDayBounds('2026-11-06', 'America/Lower_Princes');
      expect(start.toISOString()).toBe('2026-11-06T04:00:00.000Z');
      expect(end.toISOString()).toBe('2026-11-07T03:59:59.999Z');
    });

    it('includes a 21:00 AST sailing (01:00Z next UTC day) in its local day', () => {
      const sailing = new Date('2026-11-07T01:00:00.000Z');
      const { start, end } = localDayBounds('2026-11-06', 'America/Anguilla');
      expect(sailing >= start && sailing <= end).toBe(true);
      const next = localDayBounds('2026-11-07', 'America/Anguilla');
      expect(sailing >= next.start).toBe(false);
    });

    it('handles a 23 hour daylight saving day', () => {
      const { start, end } = localDayBounds('2026-03-08', 'America/New_York');
      expect(end.getTime() + 1 - start.getTime()).toBe(23 * 60 * 60 * 1000);
    });

    it('rejects a malformed date', () => {
      expect(() => localDayBounds('6/11/2026', 'America/Anguilla')).toThrow(/Invalid date/);
    });
  });

  describe('wallTimeToInstant / parseScheduleTime', () => {
    it('reads a wall time in the port zone', () => {
      expect(wallTimeToInstant('2026-11-06T08:30', 'America/Lower_Princes').toISOString()).toBe(
        '2026-11-06T12:30:00.000Z',
      );
    });

    it('treats an input with Z or an offset as an exact instant', () => {
      expect(parseScheduleTime('2026-11-06T08:30:00Z', 'America/Anguilla').toISOString()).toBe(
        '2026-11-06T08:30:00.000Z',
      );
      expect(
        parseScheduleTime('2026-11-06T08:30:00-04:00', 'America/Anguilla').toISOString(),
      ).toBe('2026-11-06T12:30:00.000Z');
    });

    it('accepts seconds and milliseconds in a wall time', () => {
      expect(parseScheduleTime('2026-11-06T08:30:15.5', 'America/Anguilla').toISOString()).toBe(
        '2026-11-06T12:30:15.500Z',
      );
    });

    it('rejects a date with no time', () => {
      expect(() => parseScheduleTime('2026-11-06', 'America/Anguilla')).toThrow(
        /Invalid local date time/,
      );
    });

    it('rejects a local time skipped by a daylight saving jump', () => {
      expect(() => wallTimeToInstant('2026-03-08T02:30', 'America/New_York')).toThrow(
        NONEXISTENT_LOCAL_TIME_MESSAGE,
      );
    });

    it('takes the first occurrence of a repeated local time', () => {
      // 01:30 happens twice on 1 Nov 2026 in New York: 05:30Z (EDT) then 06:30Z (EST).
      expect(wallTimeToInstant('2026-11-01T01:30', 'America/New_York').toISOString()).toBe(
        '2026-11-01T05:30:00.000Z',
      );
    });
  });

  describe('formatting', () => {
    it.each(AST_PORTS)('formats 12:30Z as 08:30 AM in %s regardless of server zone', zone => {
      expect(formatLocalTime(new Date('2026-11-06T12:30:00.000Z'), zone)).toBe('08:30 AM');
    });

    it('gives the port local date and today', () => {
      const lateEvening = new Date('2026-11-07T01:00:00.000Z');
      expect(localDate(lateEvening, 'America/Anguilla')).toBe('2026-11-06');
      expect(portToday('America/Anguilla', lateEvening)).toBe('2026-11-06');
    });
  });
});
