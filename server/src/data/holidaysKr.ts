/**
 * 대한민국 법정 공휴일 (대체공휴일 포함) 시드 데이터.
 * 연도별로 미리 등록해두고, F3 "연도별 공휴일 시드 데이터 불러오기" 버튼에서 사용한다.
 * 매년 인사혁신처 고시를 확인하여 새 연도를 추가해야 한다 (음력 기반 공휴일 포함).
 */
export interface HolidaySeed {
  date: string; // 'YYYY-MM-DD'
  title: string;
}

export const HOLIDAYS_BY_YEAR: Record<number, HolidaySeed[]> = {
  2026: [
    { date: '2026-01-01', title: '신정' },
    { date: '2026-02-16', title: '설날 연휴' },
    { date: '2026-02-17', title: '설날' },
    { date: '2026-02-18', title: '설날 연휴' },
    { date: '2026-03-01', title: '삼일절' },
    { date: '2026-03-02', title: '삼일절 대체공휴일' },
    { date: '2026-05-05', title: '어린이날' },
    { date: '2026-05-24', title: '부처님오신날' },
    { date: '2026-05-25', title: '부처님오신날 대체공휴일' },
    { date: '2026-06-06', title: '현충일' },
    { date: '2026-08-15', title: '광복절' },
    { date: '2026-08-17', title: '광복절 대체공휴일' },
    { date: '2026-09-24', title: '추석 연휴' },
    { date: '2026-09-25', title: '추석' },
    { date: '2026-09-26', title: '추석 연휴' },
    { date: '2026-10-03', title: '개천절' },
    { date: '2026-10-05', title: '개천절 대체공휴일' },
    { date: '2026-10-09', title: '한글날' },
    { date: '2026-12-25', title: '성탄절' },
  ],
};
