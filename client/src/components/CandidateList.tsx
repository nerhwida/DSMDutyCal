import type { Candidate, Grade } from '../types';

interface CandidateListProps {
  candidates: Candidate[];
  /** 감독 칸의 학년. 이 학년 교사를 맨 위에 보여 준다. */
  grade: Grade;
  selectedId: number | null;
  selectable: (c: Candidate) => boolean;
  onSelect: (teacherId: number) => void;
  disabled?: boolean;
}

/**
 * 감독 교사 선택 목록 (관리 변경·빈 칸 지정 팝오버 공통).
 * 학년별로 묶어 보여 준다: 감독 칸의 학년 교사 → 나머지 학년(오름차순) → 학년 미지정. 묶음 안은 이름 가나다순.
 * 여러 학년을 맡은 교사는 감독 칸의 학년을 맡으면 그 묶음에, 아니면 가장 낮은 학년 묶음에 한 번만 나온다.
 */
export function CandidateList({ candidates, grade, selectedId, selectable, onSelect, disabled }: CandidateListProps) {
  const sectionOf = (c: Candidate): number => (c.grades.includes(grade) ? grade : (c.grades[0] ?? 0));
  const order = [grade, ...([1, 2, 3] as Grade[]).filter((g) => g !== grade), 0];
  const sections = order
    .map((g) => ({
      grade: g,
      items: candidates.filter((c) => sectionOf(c) === g).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="max-h-72 overflow-y-auto rounded border border-slate-200">
      {sections.map((s) => (
        <div key={s.grade}>
          <p className="sticky top-0 border-b border-slate-100 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
            {s.grade === 0 ? '학년 미지정' : `${s.grade}학년`}
            {s.grade === grade && ' (이 칸의 학년)'}
          </p>
          <ul>
            {s.items.map((c) => {
              const reason = c.blocking ?? (c.warnings.length > 0 ? c.warnings.join(', ') : null);
              const enabled = selectable(c);
              return (
                <li key={c.teacherId}>
                  <button
                    type="button"
                    disabled={!enabled || disabled}
                    onClick={() => onSelect(c.teacherId)}
                    className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left ${
                      selectedId === c.teacherId ? 'bg-slate-800 text-white' : enabled ? 'hover:bg-slate-50' : 'text-slate-300'
                    }`}
                  >
                    <span>
                      {c.name} <span className="text-xs opacity-70">({c.monthCount})</span>
                      {c.isCurrent && <span className="ml-1 text-xs">· 현재</span>}
                      {c.isOriginal && !c.isCurrent && <span className="ml-1 text-xs">· 최초</span>}
                    </span>
                    {reason && <span className={`text-xs ${c.blocking ? 'text-red-400' : 'text-amber-500'}`}>{reason}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
