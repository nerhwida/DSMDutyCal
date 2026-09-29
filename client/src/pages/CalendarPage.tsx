import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Popover } from '../components/Popover';
import { SwapPopover } from '../components/SwapPopover';
import { ManagePopover } from '../components/ManagePopover';
import { StatusPanel } from '../components/StatusPanel';
import { RegeneratePopover } from '../components/RegeneratePopover';
import { ReopenPopover } from '../components/ReopenPopover';
import { FillPopover } from '../components/FillPopover';
import { dateLabel, formatDateTime, longDateLabel, monthGrid, shiftMonth, todayInSeoul, weekdayOf } from '../lib/date';
import {
  GROUP_LABEL,
  PLAN_STATUS_LABEL,
  SPECIAL_DAY_TYPE_LABEL,
  type AssignmentView,
  type GenerateResult,
  type Grade,
  type RegenerateResult,
  type MonthPlanStatus,
  type MonthStats,
  type MonthView,
  type SpecialDayType,
} from '../types';

const GRADES: Grade[] = [1, 2, 3];
const WEEK_HEADER = ['일', '월', '화', '수', '목', '금', '토'];

const SPECIAL_STYLE: Record<SpecialDayType, string> = {
  MANDATORY_HOME: 'bg-violet-50 text-violet-700',
  HOLIDAY: 'bg-slate-100 text-red-600',
  EXAM: 'bg-orange-50 text-orange-700',
  EVENT: 'bg-emerald-50 text-emerald-700',
  OTHER: 'bg-slate-50 text-slate-600',
};

const STATUS_BADGE: Record<MonthPlanStatus, string> = {
  EMPTY: 'bg-slate-100 text-slate-500',
  DRAFT: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-700 text-white',
};

interface PopoverState {
  assignment: AssignmentView;
  anchor: DOMRect;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

/** 같은 날의 학년별 특별 일정을 (유형, 일정명)으로 묶는다. 예: 1·2·3학년 '한글날' → 1건 */
function groupSpecials(specials: MonthView['specialDays']) {
  return [...groupBy(specials, (s) => `${s.type}\u0000${s.title}`).values()].map((list) => ({
    type: list[0].type,
    title: list[0].title,
    grades: list.map((s) => s.grade).sort(),
  }));
}

function modifiedTooltip(a: AssignmentView): string {
  const lines = [`최초: ${a.originalTeacherName} → 현재: ${a.teacherName}`];
  if (a.lastChange) {
    lines.push(`${formatDateTime(a.lastChange.changedAt)} (${a.lastChange.changedByName})`);
    if (a.lastChange.note) lines.push(`메모: ${a.lastChange.note}`);
  }
  return lines.join('\n');
}

export function CalendarPage() {
  const { user } = useAuth();
  const today = todayInSeoul();
  const [ym, setYm] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m };
  });
  const [view, setView] = useState<MonthView | null>(null);
  const [stats, setStats] = useState<MonthStats | null>(null);
  const [gradeFilter, setGradeFilter] = useState<Grade | null>(null);
  const [highlightMine, setHighlightMine] = useState(false);
  const [actionGrade, setActionGrade] = useState<Grade>(() => (user?.gradeHeadOf[0] as Grade) ?? 1);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [regenResult, setRegenResult] = useState<RegenerateResult | null>(null);
  const [toolPopover, setToolPopover] = useState<{ kind: 'regenerate' | 'reopen'; anchor: DOMRect } | null>(null);
  const [fillPopover, setFillPopover] = useState<{ date: string; grade: Grade; reasons: string[]; anchor: DOMRect } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([
        api.get<MonthView>(`/api/months/${ym.year}/${ym.month}`),
        api.get<MonthStats>(`/api/stats?year=${ym.year}&month=${ym.month}`),
      ]);
      setView(v);
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : '달력을 불러오지 못했습니다.');
    }
  }, [ym]);

  useEffect(() => {
    setResult(null);
    setRegenResult(null);
    load();
  }, [load]);

  const index = useMemo(() => {
    const assignments = new Map<string, AssignmentView>();
    const unassigned = new Map<string, string[]>();
    view?.assignments.forEach((a) => assignments.set(`${a.date}:${a.grade}`, a));
    view?.unassigned.forEach((u) => unassigned.set(`${u.date}:${u.grade}`, u.reasons));
    return {
      assignments,
      unassigned,
      specials: groupBy(view?.specialDays ?? [], (d) => d.date),
      operating: new Set(view?.operatingDays.map((d) => d.date)),
      grade: new Map(view?.grades.map((g) => [g.grade, g])),
    };
  }, [view]);

  if (!user) return null;
  const managedGrades = GRADES.filter((g) => user.gradeHeadOf.includes(g));
  const actionStatus = index.grade.get(actionGrade)?.status ?? 'EMPTY';

  function move(delta: number) {
    setYm((cur) => shiftMonth(cur.year, cur.month, delta));
  }

  async function generate() {
    if (actionStatus === 'DRAFT' && !window.confirm(`${ym.month}월 ${actionGrade}학년 미리보기를 다시 편성합니다. 고정·수동 변경 셀은 유지됩니다. 계속할까요?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<GenerateResult>(`/api/months/${ym.year}/${ym.month}/grades/${actionGrade}/generate`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '자동 편성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPlan() {
    const unassignedCount = view?.unassigned.filter((u) => u.grade === actionGrade).length ?? 0;
    const warn = unassignedCount > 0 ? `\n미배정 셀이 ${unassignedCount}개 있습니다.` : '';
    if (!window.confirm(`${ym.month}월 ${actionGrade}학년 편성을 확정할까요? 배정된 교사들에게 알림이 발송됩니다.${warn}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/months/${ym.year}/${ym.month}/grades/${actionGrade}/confirm`);
      setResult(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '확정에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function closeMonth() {
    if (!window.confirm(`${ym.month}월 ${actionGrade}학년을 마감할까요? 마감 후에는 재편성·셀 변경·본인 교체가 모두 차단되며, 해제는 관리자만 할 수 있습니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/months/${ym.year}/${ym.month}/grades/${actionGrade}/close`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '월 마감에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function openTool(kind: 'regenerate' | 'reopen', e: React.MouseEvent<HTMLButtonElement>) {
    setToolPopover({ kind, anchor: e.currentTarget.getBoundingClientRect() });
  }

  function closePopover() {
    setPopover(null);
  }

  async function afterChange() {
    setPopover(null);
    await load();
  }

  const prev = shiftMonth(ym.year, ym.month, -1);
  const next = shiftMonth(ym.year, ym.month, 1);

  return (
    <div className="min-w-[1280px] space-y-3 print:min-w-0 print:space-y-1">
      {/* 월 이동 */}
      <div className="flex items-center justify-center gap-4 text-sm print:hidden">
        <button onClick={() => move(-1)} className="text-slate-500 hover:text-slate-800">
          ◀ {prev.year}년 {prev.month}월
        </button>
        <span className="text-lg font-semibold text-slate-800">
          {ym.year}년 {ym.month}월
        </span>
        <button onClick={() => move(1)} className="text-slate-500 hover:text-slate-800">
          {next.year}년 {next.month}월 ▶
        </button>
        <button
          onClick={() => setYm({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          오늘
        </button>
      </div>

      {/* 인쇄 전용 제목 (F9) */}
      <h1 className="hidden text-center text-base font-semibold print:block">
        {ym.year}년 {ym.month}월 자율학습 감독표
        {gradeFilter ? ` (${gradeFilter}학년)` : ''}
      </h1>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm print:hidden">
        {managedGrades.length > 0 && (
          <div className="flex items-center gap-2">
            {managedGrades.length > 1 && (
              <select
                value={actionGrade}
                onChange={(e) => setActionGrade(Number(e.target.value) as Grade)}
                className="rounded border border-slate-300 px-2 py-1"
              >
                {managedGrades.map((g) => (
                  <option key={g} value={g}>
                    {g}학년
                  </option>
                ))}
              </select>
            )}
            {(actionStatus === 'EMPTY' || actionStatus === 'DRAFT') && (
              <button onClick={generate} disabled={busy} className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40">
                {actionStatus === 'DRAFT' ? '다시 편성' : `${ym.month}월 ${actionGrade}학년 자동 편성`}
              </button>
            )}
            {actionStatus === 'DRAFT' && (
              <button onClick={confirmPlan} disabled={busy} className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-40">
                편성 확정
              </button>
            )}
            {(actionStatus === 'DRAFT' || actionStatus === 'CONFIRMED') && (
              <button
                onClick={(e) => openTool('regenerate', e)}
                disabled={busy}
                className="rounded border border-slate-400 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                부분 재편성
              </button>
            )}
            {actionStatus === 'CONFIRMED' && (
              <button onClick={closeMonth} disabled={busy} className="rounded bg-slate-700 px-3 py-1.5 text-white disabled:opacity-40">
                월 마감
              </button>
            )}
            {actionStatus === 'CLOSED' && user.isAdmin && (
              <button
                onClick={(e) => openTool('reopen', e)}
                disabled={busy}
                className="rounded border border-red-400 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                마감 해제
              </button>
            )}
            <span className="mx-1 h-5 w-px bg-slate-200" />
          </div>
        )}

        <div className="flex gap-1">
          {GRADES.map((g) => {
            const s = index.grade.get(g)?.status ?? 'EMPTY';
            return (
              <span key={g} className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[s]}`}>
                {g}학년 {PLAN_STATUS_LABEL[s]}
              </span>
            );
          })}
        </div>

        <span className="mx-1 h-5 w-px bg-slate-200" />

        <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
          {([null, ...GRADES] as (Grade | null)[]).map((g) => (
            <button
              key={g ?? 'all'}
              onClick={() => setGradeFilter(g)}
              className={`px-2 py-1 ${gradeFilter === g ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {g ? `${g}학년` : '전체'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={highlightMine} onChange={(e) => setHighlightMine(e.target.checked)} />내 감독만 강조
        </label>

        <button
          onClick={() => window.print()}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          인쇄
        </button>

        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span className="rounded border-2 border-sky-600 px-1 font-semibold">내 감독</span>
          <span className="rounded bg-yellow-100 px-1" title="자동 편성 결과(확정 시점 교사)와 현재 교사가 다른 셀">
            ↻ 변경됨
          </span>
          <span>🔒 고정</span>
          <span className="rounded border border-red-500 px-1 text-red-600">미배정</span>
          <span className="rounded border border-dashed border-slate-500 px-1">미리보기</span>
        </div>
      </div>

      <div className="space-y-3 print:hidden">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <GenerateSummary result={result} onClose={() => setResult(null)} />}
        {regenResult && <RegenerateSummary result={regenResult} onClose={() => setRegenResult(null)} />}
      </div>

      <div className="flex items-start gap-4">
        {/* 달력 그리드 (직접 구현) */}
        <div className="flex-1 overflow-hidden rounded border border-slate-200 bg-white print:rounded-none print:border-slate-400">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium">
            {WEEK_HEADER.map((w, i) => (
              <div key={w} className={`py-1.5 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}>
                {w}
              </div>
            ))}
          </div>
          {monthGrid(ym.year, ym.month).map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
              {week.map((date, di) => {
                if (!date) return <div key={di} className="min-h-[96px] border-r border-slate-100 bg-slate-50/50 last:border-r-0 print:min-h-[64px]" />;
                const weekday = weekdayOf(date);
                const weekend = weekday === 0 || weekday === 6;
                // 특별 일정은 학년 단위: 전 학년이면 셀 상단 라벨, 일부 학년이면 해당 학년 줄에 표시
                const specials = index.specials.get(date) ?? [];
                const fullDay = specials.length > 0 && (weekend || specials.length === 3);
                const holiday = specials.length === 3 && specials.every((s) => s.type === 'HOLIDAY');
                const grayed = weekend || holiday;
                return (
                  <div
                    key={date}
                    className={`min-h-[96px] border-r border-slate-100 p-1 last:border-r-0 print:min-h-[64px] ${grayed ? 'bg-slate-100' : ''}`}
                  >
                    <div
                      className={`mb-0.5 text-xs ${
                        date === today ? 'inline-block rounded-full bg-slate-800 px-1.5 text-white' : weekday === 0 || holiday ? 'text-red-500' : weekday === 6 ? 'text-blue-500' : 'text-slate-500'
                      }`}
                    >
                      {Number(date.slice(8))}
                    </div>

                    {fullDay &&
                      groupSpecials(specials).map((s) => (
                        <div key={`${s.type}-${s.title}`} className={`rounded px-1 py-0.5 text-[11px] ${SPECIAL_STYLE[s.type]}`}>
                          <p className="font-medium">
                            {s.grades.length < 3 && <span className="mr-1 opacity-70">{s.grades.join('·')}학년</span>}
                            {s.title}
                          </p>
                          {!weekend && <p className="opacity-70">{SPECIAL_DAY_TYPE_LABEL[s.type]} · 감독 미편성</p>}
                        </div>
                      ))}

                    {index.operating.has(date) && (
                      <div className="space-y-0.5">
                        {GRADES.filter((g) => !gradeFilter || g === gradeFilter).map((g) => {
                          const info = index.grade.get(g);
                          const status = info?.status ?? 'EMPTY';
                          const a = index.assignments.get(`${date}:${g}`);
                          const reasons = index.unassigned.get(`${date}:${g}`);
                          const big = gradeFilter !== null;
                          const base = `flex w-full items-center gap-1 rounded px-1 text-left ${big ? 'py-1 text-sm' : 'text-xs'}`;

                          const gradeSpecial = specials.find((s) => s.grade === g);
                          if (gradeSpecial) {
                            return (
                              <div
                                key={g}
                                title={`${gradeSpecial.title} (${SPECIAL_DAY_TYPE_LABEL[gradeSpecial.type]}) · ${g}학년 감독 미편성`}
                                className={`${base} ${SPECIAL_STYLE[gradeSpecial.type]}`}
                              >
                                <span className="w-3 opacity-70">{g}</span>
                                <span className="truncate">{gradeSpecial.title}</span>
                              </div>
                            );
                          }
                          if (status === 'EMPTY') {
                            return (
                              <div key={g} className={`${base} text-slate-300`}>
                                <span className="w-3 text-slate-400">{g}</span>—
                              </div>
                            );
                          }
                          if (!info?.assignmentsVisible) {
                            return (
                              <div key={g} className={`${base} italic text-slate-400`}>
                                <span className="w-3 not-italic">{g}</span>편성 중
                              </div>
                            );
                          }
                          if (!a) {
                            const canFill = user!.gradeHeadOf.includes(g) && status !== 'CLOSED';
                            return canFill ? (
                              <button
                                key={g}
                                type="button"
                                title={[...(reasons ?? []), '클릭하여 감독 교사 직접 지정'].join('\n')}
                                onClick={(e) =>
                                  setFillPopover({ date, grade: g, reasons: reasons ?? [], anchor: e.currentTarget.getBoundingClientRect() })
                                }
                                className={`${base} border border-red-500 text-red-600 hover:bg-red-50`}
                              >
                                <span className="w-3">{g}</span>미배정 <span className="text-[10px] print:hidden">+ 지정</span>
                              </button>
                            ) : (
                              <div key={g} title={reasons?.join('\n')} className={`${base} border border-red-500 text-red-600`}>
                                <span className="w-3">{g}</span>미배정
                              </div>
                            );
                          }
                          const mine = a.teacherId === user!.id;
                          return (
                            <button
                              key={g}
                              type="button"
                              title={a.isModified ? modifiedTooltip(a) : undefined}
                              onClick={(e) => setPopover({ assignment: a, anchor: e.currentTarget.getBoundingClientRect() })}
                              className={`${base} hover:bg-slate-100 ${a.isModified ? 'bg-yellow-100' : ''} ${
                                status === 'DRAFT' ? 'border border-dashed border-slate-400' : ''
                              } ${mine ? 'font-bold ring-2 ring-sky-600 print:font-normal print:ring-0' : ''} ${
                                highlightMine && !mine ? 'opacity-30 print:opacity-100' : ''
                              }`}
                            >
                              <span className="w-3 font-normal text-slate-400">{g}</span>
                              <span className="truncate">{a.teacherName}</span>
                              {a.isModified && <span className="text-amber-600">↻</span>}
                              {a.isLocked && <span>🔒</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="print:hidden">
          <StatusPanel stats={stats} gradeFilter={gradeFilter} myId={user.id} />
        </div>
      </div>

      {fillPopover && (
        <Popover anchor={fillPopover.anchor} onClose={() => setFillPopover(null)} width={400}>
          <FillPopover
            key={`${fillPopover.date}-${fillPopover.grade}`}
            date={fillPopover.date}
            grade={fillPopover.grade}
            reasons={fillPopover.reasons}
            onDone={async () => {
              setFillPopover(null);
              await load();
            }}
            onCancel={() => setFillPopover(null)}
          />
        </Popover>
      )}

      {toolPopover && (
        <Popover anchor={toolPopover.anchor} onClose={() => setToolPopover(null)} width={400}>
          {toolPopover.kind === 'regenerate' ? (
            <RegeneratePopover
              year={ym.year}
              month={ym.month}
              grade={actionGrade}
              status={actionStatus}
              onDone={async (r) => {
                setToolPopover(null);
                setResult(null);
                setRegenResult(r);
                await load();
              }}
              onCancel={() => setToolPopover(null)}
            />
          ) : (
            <ReopenPopover
              year={ym.year}
              month={ym.month}
              grade={actionGrade}
              onDone={async () => {
                setToolPopover(null);
                await load();
              }}
              onCancel={() => setToolPopover(null)}
            />
          )}
        </Popover>
      )}

      {popover && (
        <Popover anchor={popover.anchor} onClose={closePopover} width={380}>
          <CellPopover
            key={popover.assignment.id}
            assignment={popover.assignment}
            status={index.grade.get(popover.assignment.grade)?.status ?? 'EMPTY'}
            isMine={popover.assignment.teacherId === user.id}
            canManage={user.gradeHeadOf.includes(popover.assignment.grade)}
            onDone={afterChange}
            onCancel={closePopover}
          />
        </Popover>
      )}
    </div>
  );
}

/** 셀 클릭 팝오버: 본인 감독 → 교체(F1-2), 담당 학년 → 관리 변경(F6), 그 외 → 읽기 전용. */
function CellPopover({
  assignment,
  status,
  isMine,
  canManage,
  onDone,
  onCancel,
}: {
  assignment: AssignmentView;
  status: MonthPlanStatus;
  isMine: boolean;
  canManage: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const canSwap = isMine && status === 'CONFIRMED';
  const [tab, setTab] = useState<'swap' | 'manage'>(canSwap ? 'swap' : 'manage');

  if (!canSwap && !canManage) {
    return (
      <div className="space-y-1">
        <p className="font-semibold text-slate-800">
          {longDateLabel(assignment.date)} · {assignment.grade}학년 ({GROUP_LABEL[assignment.rotationGroup]})
        </p>
        <p>
          감독: <span className="font-medium">{assignment.teacherName}</span> {assignment.isLocked && '🔒'}
        </p>
        {assignment.isModified && <p className="whitespace-pre-line text-xs text-slate-500">{modifiedTooltip(assignment)}</p>}
        {isMine && (
          <p className="text-xs text-amber-700">
            {status === 'CLOSED' ? '마감된 월은 교체할 수 없습니다.' : '확정 전인 월은 교체할 수 없습니다.'}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {canSwap && canManage && (
        <div className="flex gap-1 text-xs">
          {(['swap', 'manage'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 ${tab === t ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {t === 'swap' ? '내 감독 교체' : '관리 변경'}
            </button>
          ))}
        </div>
      )}
      {canSwap && tab === 'swap' ? (
        <SwapPopover assignment={assignment} onDone={onDone} onCancel={onCancel} />
      ) : (
        <ManagePopover assignmentId={assignment.id} onDone={onDone} onCancel={onCancel} />
      )}
    </div>
  );
}

/** 부분 재편성 결과 요약. */
function RegenerateSummary({ result, onClose }: { result: RegenerateResult; onClose: () => void }) {
  return (
    <div className={`rounded border p-3 text-sm ${result.warnings.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
      <div className="flex items-start justify-between">
        <p className="font-medium text-slate-800">
          {result.month}월 {result.grade}학년 부분 재편성 ({dateLabel(result.from)} ~ {dateLabel(result.to)}) — 변경 {result.changedCount}건,
          새로 배정 {result.filledCount}건, 동일 {result.unchangedCount}건
          {result.removedCount > 0 && `, 비움 ${result.removedCount}건`}
          {result.warnings.length > 0 && `, 후보 없음 ${result.warnings.length}건`}
        </p>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">
          닫기 ✕
        </button>
      </div>
      {result.status === 'CONFIRMED' && result.changedCount > 0 && (
        <p className="mt-1 text-xs text-slate-600">확정된 월이므로 바뀐 셀은 노란색(↻)으로 표시되고 변경 이력에 남습니다.</p>
      )}
      {result.warnings.length > 0 && (
        <details className="mt-1 text-xs text-red-700">
          <summary className="cursor-pointer">후보 없음 사유 보기</summary>
          {result.warnings.map((w) => (
            <p key={`${w.date}-${w.grade}`}>
              {longDateLabel(w.date)} {w.grade}학년: {w.reasons.join(', ')}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}

/** 편성 완료 후 공정성 요약 + 미배정 사유 (F4). */
function GenerateSummary({ result, onClose }: { result: GenerateResult; onClose: () => void }) {
  const warned = result.fairness.some((f) => f.warning);
  return (
    <div className={`rounded border p-3 text-sm ${warned || result.warnings.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
      <div className="flex items-start justify-between">
        <p className="font-medium text-slate-800">
          {result.month}월 {result.grade}학년 미리보기 편성 완료 — 새로 배정 {result.generatedCount}건, 유지 {result.keptCount}건
          {result.warnings.length > 0 && `, 미배정 ${result.warnings.length}건`}
        </p>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">
          닫기 ✕
        </button>
      </div>
      <ul className="mt-1 text-xs text-slate-700">
        {result.fairness.map((f) => (
          <li key={f.group} className={f.warning ? 'text-red-600' : ''}>
            {GROUP_LABEL[f.group]}: 이번 달 최대 {f.monthMax} / 최소 {f.monthMin} (편차 {f.monthDeviation}), 누계 편차 {f.totalDeviation}
            {f.warning && ' ⚠ 편차 2 이상'}
          </li>
        ))}
      </ul>
      {result.warnings.length > 0 && (
        <details className="mt-1 text-xs text-red-700">
          <summary className="cursor-pointer">미배정 사유 보기</summary>
          {result.warnings.map((w) => (
            <p key={`${w.date}-${w.grade}`}>
              {longDateLabel(w.date)} {w.grade}학년: {w.reasons.join(', ')}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
