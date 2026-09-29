import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Grade, InitialCount, RotationGroup, Teacher } from '../types';

const GRADES: Grade[] = [1, 2, 3];
const GROUPS: RotationGroup[] = ['WEEKDAY', 'FRIDAY'];
const GROUP_LABEL: Record<RotationGroup, string> = { WEEKDAY: '월~목', FRIDAY: '금' };

export function InitialCountsPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [counts, setCounts] = useState<InitialCount[]>([]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        api.get<Teacher[]>('/api/teachers'),
        api.get<InitialCount[]>('/api/initial-counts'),
      ]);
      setTeachers(t.filter((x) => x.active));
      setCounts(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of counts) {
      map.set(`${c.teacherId}-${c.grade}-${c.rotationGroup}`, c.count);
    }
    return map;
  }, [counts]);

  function key(teacherId: number, grade: Grade, group: RotationGroup) {
    return `${teacherId}-${grade}-${group}`;
  }

  function valueFor(teacherId: number, grade: Grade, group: RotationGroup) {
    const k = key(teacherId, grade, group);
    return edits[k] ?? countMap.get(k) ?? 0;
  }

  function onChange(teacherId: number, grade: Grade, group: RotationGroup, value: string) {
    const k = key(teacherId, grade, group);
    setEdits((prev) => ({ ...prev, [k]: Number(value) || 0 }));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const entries = Object.entries(edits).map(([k, count]) => {
        const [teacherId, grade, rotationGroup] = k.split('-');
        return {
          teacherId: Number(teacherId),
          grade: Number(grade) as Grade,
          rotationGroup: rotationGroup as RotationGroup,
          count,
        };
      });
      if (entries.length === 0) return;
      await api.put('/api/initial-counts', { entries });
      setEdits({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-800">초기 누계 입력</h2>
      <p className="text-xs text-slate-500">서비스 도입 이전까지의 감독 횟수를 교사 × 학년 × 순환그룹별로 입력합니다.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">교사</th>
              {GRADES.map((g) =>
                GROUPS.map((group) => (
                  <th key={`${g}-${group}`} className="px-2 py-2 text-center">
                    {g}학년 {GROUP_LABEL[group]}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{t.name}</td>
                {GRADES.map((g) =>
                  GROUPS.map((group) => (
                    <td key={`${g}-${group}`} className="px-2 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        value={valueFor(t.id, g, group)}
                        onChange={(e) => onChange(t.id, g, group, e.target.value)}
                        className="w-16 rounded border border-slate-300 px-1 py-0.5 text-center text-sm"
                      />
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={saveAll}
        disabled={saving || Object.keys(edits).length === 0}
        className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {saving ? '저장 중...' : '저장'}
      </button>
    </div>
  );
}
