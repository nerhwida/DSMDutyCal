/**
 * 모든 날짜는 'YYYY-MM-DD' 문자열로 다루고, 요일 계산 등은 UTC 기준으로 고정해
 * 서버 실행 환경의 시스템 타임존과 무관하게 동일한 결과를 보장한다 (8장 비기능요구사항).
 */

/** 1=월 ... 5=금, 6=토, 0=일 (JS Date.getUTCDay() 기준을 그대로 사용하되 0=일). */
export function weekdayOf(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.getUTCDay();
}

export function isWeekend(dateStr: string): boolean {
  const w = weekdayOf(dateStr);
  return w === 0 || w === 6;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Asia/Seoul 기준 오늘 날짜 'YYYY-MM-DD'. */
export function todayInSeoul(): string {
  // en-CA 로캘은 YYYY-MM-DD 형식으로 포맷된다.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 알림·경고 문구용 날짜 라벨. 예: '2026-10-15' → '10/15(목)' */
export function dateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}(${WEEKDAY_KO[weekdayOf(dateStr)]})`;
}

/** start~end(포함) 사이의 모든 날짜를 'YYYY-MM-DD' 배열로 반환한다. */
export function dateRange(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error('시작일이 종료일보다 늦을 수 없습니다.');
  }
  const dates: string[] = [];
  const cursor = new Date(startDate);
  while (cursor.getTime() <= endDate.getTime()) {
    dates.push(toDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
