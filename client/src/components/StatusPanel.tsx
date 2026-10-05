import type { Grade, MonthStats } from '../types';

interface StatusPanelProps {
  stats: MonthStats | null;
  /** 달력의 학년 선택. 지정하면 그 학년 교사와 그 학년 횟수만 보여 준다. */
  gradeFilter: Grade | null;
  myId: number;
}

type Row = MonthStats['rows'][number];
const GRADES = [1, 2, 3] as const;

/** 학년·그룹별 기록에서 전체(또는 한 학년)의 합계와 금요일 횟수. */
function sumOf(record: Record<string, number>, grade: Grade | null) {
  let all = 0;
  let friday = 0;
  for (const g of grade ? [grade] : GRADES) {
    const wk = record[`${g}:WEEKDAY`] ?? 0;
    const fr = record[`${g}:FRIDAY`] ?? 0;
    all += wk + fr;
    friday += fr;
  }
  return { all, friday };
}

/** '3(2)' — 전체 횟수 (금요일 횟수) */
const withFriday = (v: { all: number; friday: number }) => `${v.all}(${v.friday})`;

/** 총횟수 마우스 오버: 월별 확정 횟수 (초기 누계는 표시하지 않는다) */
function totalTooltip(r: Row, grade: Grade | null): string {
  const lines: string[] = [];
  for (const m of r.monthly) {
    const v = sumOf(m.byGradeGroup, grade);
    if (v.all > 0) lines.push(`${Number(m.month.slice(0, 4))}년 ${Number(m.month.slice(5, 7))}월: ${withFriday(v)}`);
  }
  if (lines.length === 0) lines.push('확정된 감독이 없습니다.');
  return ['월별 감독 횟수 (금요일)', ...lines].join('\n');
}

/** 달력 오른쪽 현황 패널 (F7 요약). 감독 변경 후 상위에서 stats를 다시 불러오면 즉시 갱신된다. */
export function StatusPanel({ stats, gradeFilter, myId }: StatusPanelProps) {
  if (!stats) return <aside className="w-80 shrink-0 text-xs text-slate-400">현황 불러오는 중…</aside>;

  const monthOf = (r: Row) => sumOf(r.monthByGradeGroup, gradeFilter);
  const totalOf = (r: Row) => sumOf(r.byGradeGroup, gradeFilter);

  // 학년을 고르면 교사 관리에서 그 학년(월~목/금)이 체크된 교사만.
  // 전체일 때는 감독 가능 학년이 있거나 배정·누계가 있는 교사.
  const visible = (r: Row) =>
    gradeFilter ? r.grades.includes(gradeFilter) : r.grades.length > 0 || r.monthTotal > 0 || r.total > 0;
  // 학년별로 묶는다: 학년을 고르면 그 학년 하나, 아니면 가장 낮은 감독 가능 학년 (없으면 '학년 미지정')
  const sectionOf = (r: Row): number => gradeFilter ?? r.grades[0] ?? 0;
  // 묶음 안은 총횟수 오름차순 → 이름순
  const sorted = stats.rows
    .filter(visible)
    .sort((a, b) => totalOf(a).all - totalOf(b).all || a.name.localeCompare(b.name, 'ko'));
  const sections = [1, 2, 3, 0]
    .map((g) => ({ grade: g, rows: sorted.filter((r) => sectionOf(r) === g) }))
    .filter((s) => s.rows.length > 0);

  return (
    <aside className="w-80 shrink-0 space-y-3">
      <div className="rounded border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
          {stats.month}월 감독 현황{gradeFilter ? ` · ${gradeFilter}학년` : ''}
        </h3>
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left">교사</th>
                <th className="px-1 py-1" title="이번 달 감독 횟수 (금요일 횟수)">
                  이번달
                </th>
                <th className="px-1 py-1" title="초기 누계 + 확정·마감된 감독 횟수 (금요일 횟수)">
                  총횟수
                </th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.grade}>
                {!gradeFilter && (
                  <tr className="border-t border-slate-200 bg-slate-50/70">
                    <td colSpan={3} className="px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {s.grade === 0 ? '학년 미지정' : `${s.grade}학년`}
                    </td>
                  </tr>
                )}
                {s.rows.map((r) => {
                  const month = monthOf(r);
                  const total = totalOf(r);
                  return (
                    <tr key={r.teacherId} className={`border-t border-slate-100 ${r.teacherId === myId ? 'bg-sky-50 font-semibold' : ''}`}>
                      <td className="px-2 py-1">
                        {r.name}
                        {!gradeFilter && r.grades.length > 1 && (
                          <span className="ml-1 text-[10px] font-normal text-slate-400">{r.grades.join('·')}</span>
                        )}
                      </td>
                      <td
                        className="cursor-help px-1 py-1 text-center"
                        title={`이번달 감독 횟수: ${month.all}, 금요일 감독: ${month.friday}`}
                      >
                        {withFriday(month)}
                      </td>
                      <td className="cursor-help px-1 py-1 text-center" title={totalTooltip(r, gradeFilter)}>
                        {withFriday(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            {sorted.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={3} className="px-2 py-3 text-center text-slate-400">
                    배정 내역이 없습니다.
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
      </div>
    </aside>
  );
}
