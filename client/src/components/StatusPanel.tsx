import { GROUP_LABEL, type Grade, type MonthStats } from '../types';

interface StatusPanelProps {
  stats: MonthStats | null;
  /** 달력의 학년 선택. 지정하면 그 학년 교사와 그 학년 횟수만 보여 준다. */
  gradeFilter: Grade | null;
  myId: number;
}

type Row = MonthStats['rows'][number];

/** 표에 보이는 값: 학년을 고르면 그 학년 것만, 아니면 전체. */
function valuesOf(r: Row, grade: Grade | null) {
  if (!grade) return { month: r.monthTotal, weekday: r.weekdayTotal, friday: r.fridayTotal, total: r.total };
  const weekday = r.byGradeGroup[`${grade}:WEEKDAY`] ?? 0;
  const friday = r.byGradeGroup[`${grade}:FRIDAY`] ?? 0;
  return { month: r.month[grade], weekday, friday, total: weekday + friday };
}

/** 달력 오른쪽 현황 패널 (F7 요약). 감독 변경 후 상위에서 stats를 다시 불러오면 즉시 갱신된다. */
export function StatusPanel({ stats, gradeFilter, myId }: StatusPanelProps) {
  if (!stats) return <aside className="w-80 shrink-0 text-xs text-slate-400">현황 불러오는 중…</aside>;

  // 감독 가능 학년이 있거나 배정·누계가 있는 교사 (학년을 고르면 그 학년 기준)
  const visible = (r: Row) => {
    const v = valuesOf(r, gradeFilter);
    return (gradeFilter ? r.grades.includes(gradeFilter) : r.grades.length > 0) || v.month > 0 || v.total > 0;
  };
  // 학년별로 묶는다: 학년을 고르면 그 학년 하나, 아니면 가장 낮은 감독 가능 학년 (없으면 '학년 미지정')
  const sectionOf = (r: Row): number => gradeFilter ?? r.grades[0] ?? 0;
  // 묶음 안은 총 감독 일수(누계) 오름차순 → 이름순
  const sorted = stats.rows
    .filter(visible)
    .sort((a, b) => valuesOf(a, gradeFilter).total - valuesOf(b, gradeFilter).total || a.name.localeCompare(b.name, 'ko'));
  const sections = [1, 2, 3, 0]
    .map((g) => ({ grade: g, rows: sorted.filter((r) => sectionOf(r) === g) }))
    .filter((s) => s.rows.length > 0);
  const fairness = stats.fairness.filter((f) => !gradeFilter || f.grade === gradeFilter);
  const columns = gradeFilter ? 5 : 8;

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
                {!gradeFilter && (
                  <>
                    <th className="px-1 py-1">1</th>
                    <th className="px-1 py-1">2</th>
                    <th className="px-1 py-1">3</th>
                  </>
                )}
                <th className="px-1 py-1">이번달</th>
                <th className="px-1 py-1">월~목</th>
                <th className="px-1 py-1">금</th>
                <th className="px-1 py-1">총</th>
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.grade}>
                {!gradeFilter && (
                  <tr className="border-t border-slate-200 bg-slate-50/70">
                    <td colSpan={columns} className="px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {s.grade === 0 ? '학년 미지정' : `${s.grade}학년`}
                    </td>
                  </tr>
                )}
                {s.rows.map((r) => {
                  const v = valuesOf(r, gradeFilter);
                  return (
                    <tr key={r.teacherId} className={`border-t border-slate-100 ${r.teacherId === myId ? 'bg-sky-50 font-semibold' : ''}`}>
                      <td className="px-2 py-1">
                        {r.name}
                        {!gradeFilter && r.grades.length > 1 && (
                          <span className="ml-1 text-[10px] font-normal text-slate-400">{r.grades.join('·')}</span>
                        )}
                      </td>
                      {!gradeFilter &&
                        ([1, 2, 3] as const).map((g) => (
                          <td key={g} className="px-1 py-1 text-center">
                            {r.month[g] || ''}
                          </td>
                        ))}
                      <td className="px-1 py-1 text-center">{v.month}</td>
                      <td className="px-1 py-1 text-center">{v.weekday}</td>
                      <td className="px-1 py-1 text-center">{v.friday}</td>
                      <td className="px-1 py-1 text-center">{v.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            {sorted.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={columns} className="px-2 py-3 text-center text-slate-400">
                    배정 내역이 없습니다.
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
        <p className="border-t border-slate-100 px-3 py-1 text-[11px] text-slate-400">
          {gradeFilter
            ? `${gradeFilter}학년 감독만 집계 · 총 누계 적은 순 · 이름순`
            : '학년별 · 총 누계 적은 순 · 이름순 (여러 학년이면 가장 낮은 학년에 표시)'}{' '}
          · 누계 = 초기 누계 + 확정·마감된 배정 ({stats.month}월 포함)
        </p>
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">공정성 (누계 편차)</h3>
        <ul className="px-3 py-2 text-xs">
          {fairness.map((f) => (
            <li key={`${f.grade}-${f.group}`} className={`flex justify-between py-0.5 ${f.warning ? 'text-red-600' : 'text-slate-600'}`}>
              <span>
                {f.grade}학년 {GROUP_LABEL[f.group]}
              </span>
              <span>
                최대 {f.max} / 최소 {f.min} / 편차 {f.deviation}
                {f.warning && ' ⚠'}
              </span>
            </li>
          ))}
          {fairness.length === 0 && <li className="text-slate-400">감독 가능 교사가 등록되지 않았습니다.</li>}
        </ul>
      </div>
    </aside>
  );
}
