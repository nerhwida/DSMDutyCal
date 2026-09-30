import type { Grade } from '../types';

const GRADES: Grade[] = [1, 2, 3];

/** 학년 체크박스 (1·2·3학년). */
export function GradeChecks({ value, onChange }: { value: Grade[]; onChange: (grades: Grade[]) => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {GRADES.map((g) => (
        <label key={g} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={value.includes(g)}
            onChange={(e) => onChange(e.target.checked ? [...new Set([...value, g])].sort() : value.filter((x) => x !== g))}
          />
          {g}학년
        </label>
      ))}
    </div>
  );
}

export const gradesLabel = (grades: Grade[]) => (grades.length === 3 ? '전 학년' : `${grades.join('·')}학년`);
