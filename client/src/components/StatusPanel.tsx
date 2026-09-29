import { GROUP_LABEL, type Grade, type MonthStats } from '../types';

interface StatusPanelProps {
  stats: MonthStats | null;
  gradeFilter: Grade | null;
  myId: number;
}

/** 달력 오른쪽 현황 패널 (F7 요약). 감독 변경 후 상위에서 stats를 다시 불러오면 즉시 갱신된다. */
export function StatusPanel({ stats, gradeFilter, myId }: StatusPanelProps) {
  if (!stats) return <aside className="w-80 shrink-0 text-xs text-slate-400">현황 불러오는 중…</aside>;

  // 이번 달 배정 또는 누계가 있는 교사만 (학년 필터 시 해당 학년 기준)
  const hasRecord = (r: MonthStats['rows'][number]) =>
    gradeFilter
      ? r.month[gradeFilter] > 0 || r.byGradeGroup[`${gradeFilter}:WEEKDAY`] > 0 || r.byGradeGroup[`${gradeFilter}:FRIDAY`] > 0
      : r.monthTotal > 0 || r.total > 0;
  const rows = stats.rows
    .filter(hasRecord)
    .sort((a, b) => b.monthTotal - a.monthTotal || a.name.localeCompare(b.name));
  const fairness = stats.fairness.filter((f) => !gradeFilter || f.grade === gradeFilter);

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
                <th className="px-1 py-1">1</th>
                <th className="px-1 py-1">2</th>
                <th className="px-1 py-1">3</th>
                <th className="px-1 py-1">이번달</th>
                <th className="px-1 py-1">월~목</th>
                <th className="px-1 py-1">금</th>
                <th className="px-1 py-1">총</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teacherId} className={`border-t border-slate-100 ${r.teacherId === myId ? 'bg-sky-50 font-semibold' : ''}`}>
                  <td className="px-2 py-1">{r.name}</td>
                  {([1, 2, 3] as const).map((g) => (
                    <td key={g} className={`px-1 py-1 text-center ${gradeFilter === g ? 'font-semibold' : ''}`}>
                      {r.month[g] || ''}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-center">{r.monthTotal}</td>
                  <td className="px-1 py-1 text-center">{r.weekdayTotal}</td>
                  <td className="px-1 py-1 text-center">{r.fridayTotal}</td>
                  <td className="px-1 py-1 text-center">{r.total}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-center text-slate-400">
                    배정 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-3 py-1 text-[11px] text-slate-400">
          누계 = 초기 누계 + 확정·마감된 배정 ({stats.month}월 포함)
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
