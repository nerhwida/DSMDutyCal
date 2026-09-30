import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Grade, GradeHeadRef, Teacher } from '../types';
import { WEEKDAY_LABEL } from '../types';
import { OrderList } from '../components/OrderList';

const GRADES: Grade[] = [1, 2, 3];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function TeacherManagementPage() {
  const { user } = useAuth();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [gradeHeads, setGradeHeads] = useState<GradeHeadRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [expandedUnavailable, setExpandedUnavailable] = useState<number | null>(null);
  const [expandedStats, setExpandedStats] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, gh] = await Promise.all([
        api.get<Teacher[]>('/api/teachers'),
        api.get<{ grade: Grade; teacherId: number }[]>('/api/grade-heads'),
      ]);
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
          <h3 className="mb-2 text-sm font-semibold text-slate-800">학년별 순환 순서 (드래그로 변경)</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {scopeGrades.map((g) => (
              <GradeOrderPanel
                key={g}
                grade={g}
                teachers={teachers}
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
  onReorder,
}: {
  grade: Grade;
  teachers: Teacher[];
  onReorder: (group: 'WEEKDAY' | 'FRIDAY', teacherIds: number[]) => void;
}) {
  const weekdayList = useMemo(
    () =>
      teachers
        .map((t) => ({ t, tg: t.teacherGrades.find((g) => g.grade === grade && g.canWeekday) }))
        .filter((x) => x.tg)
        .sort((a, b) => a.tg!.weekdayOrder - b.tg!.weekdayOrder)
        .map((x) => ({ teacherId: x.t.id, name: x.t.name })),
    [teachers, grade],
  );
  const fridayList = useMemo(
    () =>
      teachers
        .map((t) => ({ t, tg: t.teacherGrades.find((g) => g.grade === grade && g.canFriday) }))
        .filter((x) => x.tg)
        .sort((a, b) => a.tg!.fridayOrder - b.tg!.fridayOrder)
        .map((x) => ({ teacherId: x.t.id, name: x.t.name })),
    [teachers, grade],
  );

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="mb-2 text-sm font-medium text-slate-700">{grade}학년</p>
      <p className="mb-1 text-xs text-slate-500">월~목 순서</p>
      <OrderList items={weekdayList} editable onReorder={(ids) => onReorder('WEEKDAY', ids)} />
      <p className="mb-1 mt-3 text-xs text-slate-500">금요일 순서</p>
      <OrderList items={fridayList} editable onReorder={(ids) => onReorder('FRIDAY', ids)} />
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
