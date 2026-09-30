import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { todayInSeoul } from '../lib/date';
import { GROUP_LABEL, type Grade, type RangeStats } from '../types';

const GRADES: Grade[] = [1, 2, 3];

function ym(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 학년도는 3월에 시작한다 (예: 2026학년도 = 2026-03 ~ 2027-02). */
function currentSchoolYear(): number {
  const [y, m] = todayInSeoul().split('-').map(Number);
  return m >= 3 ? y : y - 1;
}

function presets(schoolYear: number) {
  return [
    { label: '1학기', from: ym(schoolYear, 3), to: ym(schoolYear, 8) },
    { label: '2학기', from: ym(schoolYear, 9), to: ym(schoolYear + 1, 2) },
    { label: '학년도 전체', from: ym(schoolYear, 3), to: ym(schoolYear + 1, 2) },
  ];
}

/** F7 통계: 기간 선택(학기 프리셋 + 직접 선택), 교사 × 학년 표, 공정성 지표. */
export function StatsPage() {
  const { user } = useAuth();
  // 공정성 지표는 관리자에게만 보여 준다
  const showFairness = !!user?.isAdmin;
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear);
  const [range, setRange] = useState(() => presets(currentSchoolYear())[2]);
  const [gradeFilter, setGradeFilter] = useState<Grade | null>(null);
  const [stats, setStats] = useState<RangeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStats(await api.get<RangeStats>(`/api/stats/range?from=${range.from}&to=${range.to}`));
    } catch (err) {
      setStats(null);
      setError(err instanceof Error ? err.message : '통계를 불러오지 못했습니다.');
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const g = gradeFilter;
  const rows = (stats?.rows ?? [])
    .map((r) => ({
      ...r,
      gradePeriod: (grade: Grade) => r.period[`${grade}:WEEKDAY`] + r.period[`${grade}:FRIDAY`],
    }))
    .filter((r) =>
      g
        ? r.period[`${g}:WEEKDAY`] + r.period[`${g}:FRIDAY`] + r.total[`${g}:WEEKDAY`] + r.total[`${g}:FRIDAY`] > 0
        : r.periodTotal > 0 || r.grandTotal > 0,
    )
    .sort((a, b) =>
      g
        ? b.gradePeriod(g) - a.gradePeriod(g) || a.name.localeCompare(b.name)
        : b.periodTotal - a.periodTotal || a.name.localeCompare(b.name),
    );
  const fairness = (stats?.fairness ?? []).filter((f) => !g || f.grade === g);

  return (
    <div className="max-w-6xl space-y-4">
      <h2 className="text-base font-semibold text-slate-800">통계</h2>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
        <div className="flex items-center gap-1">
          <button onClick={() => setSchoolYear((y) => y - 1)} className="px-1 text-slate-500 hover:text-slate-800">
            ◀
          </button>
          <span className="font-medium">{schoolYear}학년도</span>
          <button onClick={() => setSchoolYear((y) => y + 1)} className="px-1 text-slate-500 hover:text-slate-800">
            ▶
          </button>
        </div>
        <div className="flex gap-1">
          {presets(schoolYear).map((p) => {
            const active = p.from === range.from && p.to === range.to;
            return (
              <button
                key={p.label}
                onClick={() => setRange(p)}
                className={`rounded px-2 py-1 text-xs ${active ? 'bg-slate-800 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-100'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <div className="flex items-center gap-1 text-xs">
          직접 선택
          <input
            type="month"
            value={range.from}
            onChange={(e) => e.target.value && setRange({ label: '직접', from: e.target.value, to: range.to })}
            className="rounded border border-slate-300 px-1 py-0.5"
          />
          ~
          <input
            type="month"
            value={range.to}
            onChange={(e) => e.target.value && setRange({ label: '직접', from: range.from, to: e.target.value })}
            className="rounded border border-slate-300 px-1 py-0.5"
          />
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
          {([null, ...GRADES] as (Grade | null)[]).map((grade) => (
            <button
              key={grade ?? 'all'}
              onClick={() => setGradeFilter(grade)}
              className={`px-2 py-1 ${gradeFilter === grade ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {grade ? `${grade}학년` : '전체'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {stats && (
        <>
          <p className="text-xs text-slate-500">
            기간 {stats.from} ~ {stats.to} · 확정·마감된 배정만 집계 (미리보기 제외) · 누계 = 초기 누계 + 기간 끝까지의 확정·마감 배정
          </p>

          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                {g ? (
                  <tr>
                    <th className="px-3 py-2 text-left">교사</th>
                    <th className="px-3 py-2">기간 {GROUP_LABEL.WEEKDAY}</th>
                    <th className="px-3 py-2">기간 {GROUP_LABEL.FRIDAY}</th>
                    <th className="px-3 py-2">기간 합계</th>
                    <th className="px-3 py-2">{GROUP_LABEL.WEEKDAY} 누계</th>
                    <th className="px-3 py-2">{GROUP_LABEL.FRIDAY} 누계</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-3 py-2 text-left">교사</th>
                    {GRADES.map((grade) => (
                      <th key={grade} className="px-3 py-2">
                        {grade}학년
                      </th>
                    ))}
                    <th className="px-3 py-2">기간 합계</th>
                    <th className="px-3 py-2">{GROUP_LABEL.WEEKDAY} 누계</th>
                    <th className="px-3 py-2">{GROUP_LABEL.FRIDAY} 누계</th>
                    <th className="px-3 py-2">총 누계</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.teacherId} className={`border-t border-slate-100 text-center ${r.active ? '' : 'text-slate-400'}`}>
                    <td className="px-3 py-1.5 text-left">
                      {r.name}
                      {!r.active && ' (비활성)'}
                      {r.excludedMonths.length > 0 && (
                        <span
                          className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-500"
                          title="이 달들은 통계에서 제외되어 공정성 지표에 포함되지 않습니다"
                        >
                          제외 {r.excludedMonths.map((m) => `${Number(m.slice(5))}월`).join('·')}
                        </span>
                      )}
                    </td>
                    {g ? (
                      <>
                        <td className="px-3 py-1.5">{r.period[`${g}:WEEKDAY`]}</td>
                        <td className="px-3 py-1.5">{r.period[`${g}:FRIDAY`]}</td>
                        <td className="px-3 py-1.5 font-medium">{r.gradePeriod(g)}</td>
                        <td className="px-3 py-1.5">{r.total[`${g}:WEEKDAY`]}</td>
                        <td className="px-3 py-1.5">{r.total[`${g}:FRIDAY`]}</td>
                      </>
                    ) : (
                      <>
                        {GRADES.map((grade) => (
                          <td key={grade} className="px-3 py-1.5">
                            {r.gradePeriod(grade) || ''}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 font-medium">{r.periodTotal}</td>
                        <td className="px-3 py-1.5">{r.weekdayTotal}</td>
                        <td className="px-3 py-1.5">{r.fridayTotal}</td>
                        <td className="px-3 py-1.5 font-medium">{r.grandTotal}</td>
                      </>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-xs text-slate-400">
                      해당 기간에 확정된 배정이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {showFairness && (
            <div className="rounded border border-slate-200 bg-white">
              <h3 className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">공정성 지표</h3>
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-1 text-left">학년·그룹</th>
                    <th className="px-3 py-1">기간 최대 / 최소 / 편차</th>
                    <th className="px-3 py-1">누계 최대 / 최소 / 편차</th>
                  </tr>
                </thead>
                <tbody>
                  {fairness.map((f) => (
                    <tr key={`${f.grade}-${f.group}`} className="border-t border-slate-100 text-center">
                      <td className="px-3 py-1 text-left">
                        {f.grade}학년 {GROUP_LABEL[f.group]}
                      </td>
                      <td className={`px-3 py-1 ${f.period.warning ? 'text-red-600' : ''}`}>
                        {f.period.max} / {f.period.min} / {f.period.deviation}
                        {f.period.warning && ' ⚠'}
                      </td>
                      <td className={`px-3 py-1 ${f.total.warning ? 'text-red-600' : ''}`}>
                        {f.total.max} / {f.total.min} / {f.total.deviation}
                        {f.total.warning && ' ⚠'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-slate-100 px-3 py-1 text-[11px] text-slate-400">
                해당 학년·그룹 감독이 가능한 활성 교사 기준 (기간 중 통계 제외 월이 있는 교사 제외) · 편차 2 이상이면 ⚠
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
