import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Grade, GradeHeadRef, RotationStatus, Teacher } from '../types';
import { WEEKDAY_LABEL } from '../types';
import { OrderList } from '../components/OrderList';

const GRADES: Grade[] = [1, 2, 3];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function TeacherManagementPage() {
  const { user } = useAuth();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [gradeHeads, setGradeHeads] = useState<GradeHeadRef[]>([]);
  // 순환 현황 (순서·다음 시작·밀린 차례 + 교사별 확정 통계 총횟수·금요일 횟수)
  const [rotation, setRotation] = useState<RotationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [expandedUnavailable, setExpandedUnavailable] = useState<number | null>(null);
  const [expandedStats, setExpandedStats] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, gh, rot] = await Promise.all([
        api.get<Teacher[]>('/api/teachers'),
        api.get<{ grade: Grade; teacherId: number }[]>('/api/grade-heads'),
        api.get<RotationStatus[]>('/api/grades/rotation-status'),
      ]);
      setRotation(rot);
      setTeachers(t);
      setGradeHeads(gh);
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;

  const canEditGrade = (grade: Grade) => user.isAdmin || user.gradeHeadOf.includes(grade);
  const isSelfOrAdmin = (teacherId: number) => user.isAdmin || user.id === teacherId;
  // 통계 제외 월은 관리자·학년부장이 관리한다
  const canManageStats = user.gradeHeadOf.length > 0;

  async function handleError(fn: () => Promise<void>) {
    try {
      setError(null);
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청이 실패했습니다.');
    }
  }

  async function toggleGrade(teacher: Teacher, grade: Grade, field: 'canWeekday' | 'canFriday', value: boolean) {
    await handleError(async () => {
      const tg = teacher.teacherGrades.find((g) => g.grade === grade);
      await api.put(`/api/teachers/${teacher.id}/grades`, {
        grade,
        canWeekday: field === 'canWeekday' ? value : tg?.canWeekday ?? false,
        canFriday: field === 'canFriday' ? value : tg?.canFriday ?? false,
      });
      await load();
    });
  }

  async function toggleAfterSchool(teacher: Teacher, weekday: number, checked: boolean) {
    await handleError(async () => {
      const others = teacher.weekdayExclusions.filter(
        (e) => e.reason !== 'AFTER_SCHOOL' || e.weekday !== weekday,
      );
      const next = checked
        ? [...others, { weekday, reason: 'AFTER_SCHOOL' as const }]
        : others;
      await api.put(
        `/api/teachers/${teacher.id}/weekday-exclusions`,
        next.map((e) => ({ weekday: e.weekday, reason: e.reason })),
      );
      await load();
    });
  }

  async function toggleActive(teacher: Teacher) {
    await handleError(async () => {
      await api.put(`/api/teachers/${teacher.id}`, { active: !teacher.active });
      await load();
    });
  }

  async function resetPin(teacher: Teacher) {
    await handleError(async () => {
      const res = await api.post<{ ok: true; newPin: string }>(`/api/teachers/${teacher.id}/reset-pin`);
      setNotice(`${teacher.name} 선생님의 새 PIN: ${res.newPin} (최초 로그인 시 변경 필요)`);
      await load();
    });
  }

  async function removeTeacher(teacher: Teacher) {
    await handleError(async () => {
      await api.delete(`/api/teachers/${teacher.id}`);
      await load();
    });
  }

  async function addUnavailable(teacher: Teacher, date: string, reason: string) {
    await handleError(async () => {
      await api.post(`/api/teachers/${teacher.id}/unavailable`, { date, reason });
      await load();
    });
  }

  async function removeUnavailable(teacher: Teacher, recordId: number) {
    await handleError(async () => {
      await api.delete(`/api/teachers/${teacher.id}/unavailable/${recordId}`);
      await load();
    });
  }

  async function addStatsExclusion(teacher: Teacher, from: string, to: string) {
    await handleError(async () => {
      await api.post(`/api/teachers/${teacher.id}/stats-exclusions`, { from, to: to || from });
      await load();
    });
  }

  async function removeStatsExclusion(teacher: Teacher, recordId: number) {
    await handleError(async () => {
      await api.delete(`/api/teachers/${teacher.id}/stats-exclusions/${recordId}`);
      await load();
    });
  }

  async function createTeacher(e: React.FormEvent) {
    e.preventDefault();
    await handleError(async () => {
      await api.post('/api/teachers', { name: newName, initialPin: newPin });
      setNewName('');
      setNewPin('');
      await load();
    });
  }

  async function setGradeHead(grade: Grade, teacherId: number) {
    await handleError(async () => {
      await api.put(`/api/grade-heads/${grade}`, { teacherId });
      await load();
    });
  }

  async function reorder(grade: Grade, rotationGroup: 'WEEKDAY' | 'FRIDAY', teacherIds: number[]) {
    await handleError(async () => {
      await api.put(`/api/grades/${grade}/order`, { rotationGroup, teacherIds });
      await load();
    });
  }

  const scopeGrades = GRADES.filter(canEditGrade);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-2 text-base font-semibold text-slate-800">교사 관리</h2>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {notice && (
          <p className="mb-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>
        )}
        <p className="mb-2 text-xs text-slate-500">
          방과후 요일은 <b>일정 관리 → 방과후 운영일</b>에 등록된 날에만 감독에서 제외됩니다.
        </p>

        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">교사</th>
                <th className="px-3 py-2 text-left">활성</th>
                {GRADES.map((g) => (
                  <th key={g} className="px-3 py-2 text-left">
                    {g}학년 (월~목/금)
                  </th>
                ))}
                {WEEKDAYS.map((w) => (
                  <th key={w} className="px-2 py-2 text-center">
                    {WEEKDAY_LABEL[w]} 방과후
                  </th>
                ))}
                <th className="px-3 py-2 text-left">감독 불가일</th>
                <th className="px-3 py-2 text-left" title="휴직·파견 등으로 그 달 통계 목록과 공정성 지표에서 뺄 월">
                  통계 제외 월
                </th>
                <th className="px-3 py-2 text-left">관리</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className={`border-t border-slate-100 ${!t.active ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">{t.name}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={t.active}
                      disabled={!user.isAdmin}
                      onChange={() => toggleActive(t)}
                    />
                  </td>
                  {GRADES.map((g) => {
                    const tg = t.teacherGrades.find((x) => x.grade === g);
                    const editable = canEditGrade(g);
                    return (
                      <td key={g} className="px-3 py-2">
                        <label className="mr-2 inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={tg?.canWeekday ?? false}
                            disabled={!editable}
                            onChange={(e) => toggleGrade(t, g, 'canWeekday', e.target.checked)}
                          />
                          <span className="text-xs">월~목</span>
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={tg?.canFriday ?? false}
                            disabled={!editable}
                            onChange={(e) => toggleGrade(t, g, 'canFriday', e.target.checked)}
                          />
                          <span className="text-xs">금</span>
                        </label>
                      </td>
                    );
                  })}
                  {WEEKDAYS.map((w) => {
                    const checked = t.weekdayExclusions.some(
                      (e) => e.weekday === w && e.reason === 'AFTER_SCHOOL',
                    );
                    const editable = isSelfOrAdmin(t.id);
                    return (
                      <td key={w} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!editable}
                          onChange={(e) => toggleAfterSchool(t, w, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <button
                      className="text-xs text-slate-600 underline"
                      onClick={() => setExpandedUnavailable(expandedUnavailable === t.id ? null : t.id)}
                    >
                      {t.unavailableDates.length}건 관리
                    </button>
                    {expandedUnavailable === t.id && (
                      <UnavailablePanel
                        teacher={t}
                        editable={isSelfOrAdmin(t.id)}
                        onAdd={(date, reason) => addUnavailable(t, date, reason)}
                        onRemove={(id) => removeUnavailable(t, id)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="text-xs text-slate-600 underline"
                      onClick={() => setExpandedStats(expandedStats === t.id ? null : t.id)}
                    >
                      {t.statsExclusions.length > 0 ? `${t.statsExclusions.length}개월` : '없음'}
                    </button>
                    {expandedStats === t.id && (
                      <StatsExclusionPanel
                        teacher={t}
                        editable={canManageStats}
                        onAdd={(from, to) => addStatsExclusion(t, from, to)}
                        onRemove={(id) => removeStatsExclusion(t, id)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {user.isAdmin && (
                      <div className="flex flex-col gap-1">
                        <button className="text-xs text-blue-600 underline" onClick={() => resetPin(t)}>
                          PIN 초기화
                        </button>
                        <button className="text-xs text-red-600 underline" onClick={() => removeTeacher(t)}>
                          삭제
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {user.isAdmin && (
          <form onSubmit={createTeacher} className="mt-4 flex items-end gap-2">
            <div>
              <label className="block text-xs text-slate-500">이름</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">초기 PIN (4~6자리)</label>
              <input
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                maxLength={6}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
            >
              교사 등록
            </button>
          </form>
        )}
      </div>

      {user.isAdmin && <ResetAllPinsPanel onDone={(msg) => { setNotice(msg); load(); }} onError={setError} />}

      {user.isAdmin && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">학년부장 지정</h3>
          <div className="flex gap-4">
            {GRADES.map((g) => {
              const current = gradeHeads.find((h) => h.grade === g);
              return (
                <div key={g}>
                  <label className="block text-xs text-slate-500">{g}학년 부장</label>
                  <select
                    value={current?.teacherId ?? ''}
                    onChange={(e) => setGradeHead(g, Number(e.target.value))}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">미지정</option>
                    {teachers
                      .filter((t) => t.active)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scopeGrades.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-800">학년별 순환 순서 (드래그로 변경)</h3>
          <p className="mb-2 text-xs text-slate-500">
            자동 편성은 이 순서대로 돌아가며 배정합니다(그날 감독이 불가한 교사는 건너뜀). 오른쪽 숫자는 참고용으로, 월~목
            순서는 총횟수, 금요일 순서는 금요일 횟수입니다 (전 학년 합계, 초기 누계 + 확정된 감독 전체 — 미리보기 제외).
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {scopeGrades.map((g) => (
              <GradeOrderPanel
                key={g}
                grade={g}
                teachers={teachers}
                rotation={rotation.filter((r) => r.grade === g)}
                onReorder={(group, ids) => reorder(g, group, ids)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GradeOrderPanel({
  grade,
  teachers,
  rotation,
  onReorder,
}: {
  grade: Grade;
  teachers: Teacher[];
  rotation: RotationStatus[];
  onReorder: (group: 'WEEKDAY' | 'FRIDAY', teacherIds: number[]) => void;
}) {
  // 교사별 확정 통계 총횟수·금요일 횟수 (서버 순환 현황이 계산, 전 학년 같은 값)
  const totalsOf = useMemo(() => {
    const map = new Map<number, { total: number; friday: number }>();
    for (const r of rotation) for (const o of r.order) map.set(o.teacherId, { total: o.total, friday: o.friday });
    return map;
  }, [rotation]);
  // 저장된 순번 순 (자동 편성이 이 순서대로 배정한다). 횟수는 참고용으로 표시한다.
  const listOf = useCallback(
    (group: 'WEEKDAY' | 'FRIDAY') =>
      teachers
        .map((t) => ({ t, tg: t.teacherGrades.find((g) => g.grade === grade && (group === 'WEEKDAY' ? g.canWeekday : g.canFriday)) }))
        .filter((x) => x.tg)
        .map((x) => ({
          teacherId: x.t.id,
          name: x.t.name,
          // 월~목 목록은 확정 통계 총횟수, 금요일 목록은 금요일 횟수 (전 학년, 초기 누계 + 확정·마감 전체)
          total: group === 'WEEKDAY' ? (totalsOf.get(x.t.id)?.total ?? 0) : (totalsOf.get(x.t.id)?.friday ?? 0),
          order: group === 'WEEKDAY' ? x.tg!.weekdayOrder : x.tg!.fridayOrder,
        }))
        .sort((a, b) => a.order - b.order),
    [teachers, totalsOf, grade],
  );
  const weekdayList = useMemo(() => listOf('WEEKDAY'), [listOf]);
  const fridayList = useMemo(() => listOf('FRIDAY'), [listOf]);

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="mb-2 text-sm font-medium text-slate-700">{grade}학년</p>
      <p className="mb-1 text-xs text-slate-500">월~목 순서</p>
      <RotationSummary status={rotation.find((r) => r.group === 'WEEKDAY')} />
      <OrderList
        items={weekdayList}
        editable
        totalTitle="확정 총횟수 (전 학년 월~목+금, 초기 누계 + 확정된 감독 전체, 미리보기 제외)"
        onReorder={(ids) => onReorder('WEEKDAY', ids)}
      />
      <p className="mb-1 mt-3 text-xs text-slate-500">금요일 순서</p>
      <RotationSummary status={rotation.find((r) => r.group === 'FRIDAY')} />
      <OrderList
        items={fridayList}
        editable
        totalTitle="확정 금요일 횟수 (전 학년, 초기 누계 + 확정된 감독 전체, 미리보기 제외)"
        onReorder={(ids) => onReorder('FRIDAY', ids)}
      />
    </div>
  );
}

function UnavailablePanel({
  teacher,
  editable,
  onAdd,
  onRemove,
}: {
  teacher: Teacher;
  editable: boolean;
  onAdd: (date: string, reason: string) => void;
  onRemove: (recordId: number) => void;
}) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="mt-2 w-64 rounded border border-slate-200 bg-slate-50 p-2">
      <ul className="mb-2 space-y-1">
        {teacher.unavailableDates.map((u) => (
          <li key={u.id} className="flex items-center justify-between text-xs">
            <span>
              {u.date} · {u.reason}
            </span>
            {editable && (
              <button className="text-red-500" onClick={() => onRemove(u.id)}>
                삭제
              </button>
            )}
          </li>
        ))}
        {teacher.unavailableDates.length === 0 && (
          <li className="text-xs text-slate-400">등록된 불가일이 없습니다.</li>
        )}
      </ul>
      {editable && (
        <div className="flex gap-1">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
          />
          <input
            type="text"
            placeholder="사유"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
          />
          <button
            className="rounded bg-slate-700 px-2 text-xs text-white"
            onClick={() => {
              if (date && reason) {
                onAdd(date, reason);
                setDate('');
                setReason('');
              }
            }}
          >
            추가
          </button>
        </div>
      )}
    </div>
  );
}

/** 통계 제외 월 (휴직·파견 등). 그 달 통계 목록과 공정성 지표에서 뺀다. */
function StatsExclusionPanel({
  teacher,
  editable,
  onAdd,
  onRemove,
}: {
  teacher: Teacher;
  editable: boolean;
  onAdd: (from: string, to: string) => void;
  onRemove: (recordId: number) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  return (
    <div className="mt-2 w-64 rounded border border-slate-200 bg-slate-50 p-2">
      <p className="mb-1 text-[11px] text-slate-500">
        제외한 달에는 통계·현황 목록에 나오지 않고 공정성 지표에서도 빠집니다. 감독 횟수와 편성은 그대로입니다.
      </p>
      <ul className="mb-2 flex flex-wrap gap-1">
        {teacher.statsExclusions.map((e) => (
          <li key={e.id} className="flex items-center gap-1 rounded bg-white px-1.5 text-xs ring-1 ring-slate-200">
            {e.year}.{String(e.month).padStart(2, '0')}
            {editable && (
              <button className="text-red-500" title="삭제" onClick={() => onRemove(e.id)}>
                ×
              </button>
            )}
          </li>
        ))}
        {teacher.statsExclusions.length === 0 && <li className="text-xs text-slate-400">제외한 달이 없습니다.</li>}
      </ul>
      {editable && (
        <div className="flex flex-wrap items-center gap-1">
          <input
            type="month"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
          />
          ~
          <input
            type="month"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="비우면 한 달만"
            className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
          />
          <button
            className="rounded bg-slate-700 px-2 text-xs text-white"
            onClick={() => {
              if (from) {
                onAdd(from, to);
                setFrom('');
                setTo('');
              }
            }}
          >
            추가
          </button>
        </div>
      )}
    </div>
  );
}

/** 관리자를 뺀 교사 전원의 PIN 일괄 초기화 (서비스 안내용). 관리자 본인 PIN으로 다시 확인한다. */
function ResetAllPinsPanel({ onDone, onError }: { onDone: (message: string) => void; onError: (message: string) => void }) {
  const [newPin, setNewPin] = useState('0000');
  const [adminPin, setAdminPin] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !window.confirm(
        `관리자를 뺀 모든 교사의 PIN을 ${newPin}(으)로 초기화합니다. 각 교사는 다음 로그인 때 PIN을 바꿔야 합니다. 계속할까요?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: true; count: number }>('/api/teachers/reset-pin-all', { newPin, adminPin });
      setAdminPin('');
      onDone(`교사 ${res.count}명의 PIN을 ${newPin}(으)로 초기화했습니다. 각자 첫 로그인 때 새 PIN으로 바꾸게 됩니다.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'PIN 일괄 초기화에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-800">전체 PIN 일괄 초기화</h3>
      <p className="mb-2 text-xs text-slate-500">
        관리자를 뺀 교사 전원의 PIN을 같은 값으로 바꾸고, 다음 로그인 때 새 PIN으로 바꾸도록 합니다(같은 PIN은 다시 쓸 수 없음).
        초기화한 동안에는 이름만 알면 누구나 그 교사로 로그인할 수 있으니, 안내 후 바로 바꾸도록 해 주세요.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500">초기화 PIN</label>
          <input
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
            maxLength={6}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">관리자 본인 PIN 확인</label>
          <input
            type="password"
            inputMode="numeric"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ''))}
            maxLength={6}
            className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !/^\d{4,6}$/.test(newPin) || !adminPin}
          className="rounded border border-red-400 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          전체 초기화
        </button>
      </form>
    </div>
  );
}

/** 순환 현황 한 줄 요약: 이름-이름-… 순서와 다음 자동 편성 시작 교사 (서버가 엔진과 같은 규칙으로 계산). */
function RotationSummary({ status }: { status?: RotationStatus }) {
  if (!status || status.order.length === 0) return null;
  const lastLabel = status.last
    ? `${Number(status.last.date.slice(0, 4))}년 ${Number(status.last.date.slice(5, 7))}월 마지막 확정: ${status.last.name}`
    : '확정된 감독 없음 → 1번부터';
  return (
    <div className="mb-1.5 rounded bg-slate-50 px-2 py-1 text-xs leading-relaxed text-slate-600">
      <p>
        {status.order.map((o, i) => (
          <span key={o.teacherId}>
            {i > 0 && <span className="text-slate-300">-</span>}
            <span className={o.teacherId === status.next?.teacherId ? 'font-semibold text-sky-700' : ''}>{o.name}</span>
          </span>
        ))}
      </p>
      {status.owed.length > 0 && (
        <p className="text-amber-700">
          밀린 차례(지난달에서 이어짐): {status.owed.map((o) => o.name).join(', ')} — 다음 편성에서 가능한 첫날 먼저 맡습니다.
        </p>
      )}
      {status.next && (
        <p className="text-sky-700">
          ▶ 다음 시작: <b>{status.next.name}</b>{' '}
          <span className="text-slate-400">({status.owed.length > 0 ? '밀린 차례' : lastLabel})</span>
        </p>
      )}
    </div>
  );
}
