const API_VERSION = /^[A-Za-z0-9._~-]{1,64}$/;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._~-]{22,128}$/;
const XEP_0082_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

interface Xep0082Instant {
  epochSecond: bigint;
  fraction: string;
}

export function isApiVersion(value: string): boolean {
  return API_VERSION.test(value);
}

export function isOpaqueIdentifier(value: string): boolean {
  return OPAQUE_IDENTIFIER.test(value);
}

export function isXep0082DateTime(value: string): boolean {
  const match = XEP_0082_DATE_TIME.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (day < 1 || day > daysInMonth) return false;
  if (offsetHourText) {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}

/**
 * Compare represented XEP-0082 instants without truncating fractional seconds.
 * Both inputs must already satisfy isXep0082DateTime().
 */
export function compareXep0082DateTimes(left: string, right: string): number {
  const a = parseXep0082Instant(left);
  const b = parseXep0082Instant(right);
  if (!a || !b) throw new Error('invalid XEP-0082 date-time');
  if (a.epochSecond < b.epochSecond) return -1;
  if (a.epochSecond > b.epochSecond) return 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(width, '0');
  const bFraction = b.fraction.padEnd(width, '0');
  return aFraction < bFraction ? -1 : aFraction > bFraction ? 1 : 0;
}

export function compareXep0082DateTimeToDate(value: string, date: Date): number {
  return compareXep0082DateTimes(value, date.toISOString());
}

/** Smallest integral epoch millisecond that is not before the represented instant. */
export function xep0082DateTimeToEpochMillisecondsCeil(value: string): number {
  const instant = parseXep0082Instant(value);
  if (!instant) throw new Error('invalid XEP-0082 date-time');
  const milliseconds = Number(instant.epochSecond) * 1_000;
  const firstThreeDigits = Number(instant.fraction.padEnd(3, '0').slice(0, 3));
  const hasSubMillisecondRemainder = /[1-9]/.test(instant.fraction.slice(3));
  return milliseconds + firstThreeDigits + (hasSubMillisecondRemainder ? 1 : 0);
}

export function isXml10Text(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d &&
      (codePoint < 0x20 ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        codePoint === 0xfffe ||
        codePoint === 0xffff ||
        codePoint > 0x10ffff)
    ) {
      return false;
    }
  }
  return true;
}

export function isToolName(value: string): boolean {
  return value.length > 0 && isXml10Text(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseXep0082Instant(value: string): Xep0082Instant | null {
  if (!isXep0082DateTime(value)) return null;
  const match = XEP_0082_DATE_TIME.exec(value)!;
  const [, year, month, day, hour, minute, second, fraction = '', offsetSign, offsetHour = '0', offsetMinute = '0'] =
    match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const signedOffsetSeconds =
    (offsetSign === '-' ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute)) * 60;
  return {
    epochSecond: BigInt(date.getTime() / 1_000 - signedOffsetSeconds),
    fraction,
  };
}
