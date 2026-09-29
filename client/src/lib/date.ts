// 모든 날짜는 'YYYY-MM-DD' 문자열로 다룬다 (Asia/Seoul, Date 객체 타임존 오류 방지).
// 요일 계산은 UTC 자정 기준으로 고정한다 (서버 dateUtils와 동일).

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 0=일 ... 6=토 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function todayInSeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/** '2026-10-15' → '10/15(목)' */
export function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAY_KO[weekdayOf(date)]})`;
}

/** '2026-10-15' → '10월 15일(목)' */
export function longDateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일(${WEEKDAY_KO[weekdayOf(date)]})`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 달력 그리드: 일~토 7열, 주 단위 배열. 해당 월이 아닌 칸은 null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = toDateString(year, month, 1);
  const leading = weekdayOf(first);
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= lastDayOf(year, month); d++) cells.push(toDateString(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 서버 DateTime(ISO) → '2026.10.13 14:32' (Asia/Seoul) */
export function formatDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}
