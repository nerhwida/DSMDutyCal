import { useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { matchesHangul } from '../lib/hangul';
import type { Candidate, CellCandidatesResponse, Grade } from '../types';

interface QuickFillInputProps {
  date: string;
  grade: Grade;
  /** 칸 식별자. 저장 후 다음 칸으로 포커스를 옮길 때 쓴다. */
  cellKey: string;
  placeholder: string;
  className?: string;
  /** 저장 완료. nextKey = 문서 순서상 다음 입력 칸 (없으면 null). */
  onSaved: (nextKey: string | null) => void;
}

const MAX_ITEMS = 8;

/**
 * 키보드로 빈 칸에 감독 교사 지정 (달력 '키보드 입력' 모드).
 * 이름 일부나 초성(예: 'ㄱㅁ')을 치면 그 칸에 배정 가능한 교사가 뜨고, ↑/↓로 고른 뒤 Enter로 저장한다.
 * Tab·Shift+Tab은 같은 학년의 다음·이전 날짜 칸으로, (목록이 없을 때) ↑/↓는 같은 날짜의 위·아래 학년 칸으로 이동한다.
 * Enter로 저장하면 같은 학년의 다음 날짜 칸으로 넘어간다.
 * 그날 감독할 수 없는 교사(같은 날 다른 학년 감독 중 등)와 관리자 계정은 목록에서 빼고, 경고가 있는 교사는 ⚠와 사유를 붙여 보여 준다.
 */
export function QuickFillInput({ date, grade, cellKey, placeholder, className, onSaved }: QuickFillInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadCandidates() {
    if (candidates) return;
    try {
      const res = await api.get<CellCandidatesResponse>(`/api/assignments/candidates?date=${date}&grade=${grade}`);
      // 이 칸의 학년 교사 먼저, 경고 없는 교사 먼저, 그다음 이름순
      setCandidates(
        res.candidates
          // 감독할 수 없는 교사와 관리자 계정은 목록에서 뺀다
          .filter((c) => !c.blocking && !c.isAdmin)
          .sort(
            (a, b) =>
              Number(!a.grades.includes(grade)) - Number(!b.grades.includes(grade)) ||
              Number(a.warnings.length > 0) - Number(b.warnings.length > 0) ||
              a.name.localeCompare(b.name, 'ko'),
          ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '교사 목록을 불러오지 못했습니다.');
    }
  }

  const matches = useMemo(
    () => (query.trim() ? (candidates ?? []).filter((c) => matchesHangul(c.name, query)).slice(0, MAX_ITEMS) : []),
    [candidates, query],
  );

  /** 달력의 다른 입력칸 찾기: 같은 학년의 다음/이전 날짜, 또는 같은 날짜의 아래/위 학년. */
  function findInput(kind: 'date' | 'grade', dir: 1 | -1): HTMLInputElement | null {
    const cells = [...document.querySelectorAll<HTMLInputElement>('input[data-quickfill]')].map((el) => {
      const [d, g] = el.dataset.quickfill!.split(':');
      return { el, date: d, grade: Number(g) };
    });
    const candidatesOf =
      kind === 'date'
        ? cells.filter((c) => c.grade === grade && (dir > 0 ? c.date > date : c.date < date))
        : cells.filter((c) => c.date === date && (dir > 0 ? c.grade > grade : c.grade < grade));
    const value = (c: (typeof cells)[number]) => (kind === 'date' ? c.date : String(c.grade));
    candidatesOf.sort((a, b) => (value(a) < value(b) ? -dir : value(a) > value(b) ? dir : 0));
    return candidatesOf[0]?.el ?? null;
  }

  /** 저장 후 이동할 칸: 같은 학년의 다음 날짜 */
  function nextInputKey(): string | null {
    return findInput('date', 1)?.dataset.quickfill ?? null;
  }

  function moveTo(target: HTMLInputElement | null, e: React.KeyboardEvent) {
    if (!target) return;
    e.preventDefault();
    setOpen(false);
    target.focus();
  }

  async function choose(c: Candidate) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/assignments', {
        date,
        grade,
        teacherId: c.teacherId,
        // 목록에서 경고(⚠)를 보고 직접 고른 교사는 강제 배정으로 저장한다
        force: c.warnings.length > 0 || undefined,
        note: '키보드 입력',
      });
      setOpen(false);
      onSaved(nextInputKey());
    } catch (err) {
      const warnings = err instanceof ApiError ? (err.body as { warnings?: string[] })?.warnings : undefined;
      setError([err instanceof Error ? err.message : '지정에 실패했습니다.', ...(warnings ?? [])].join('\n'));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const listShown = open && matches.length > 0;
    if (e.key === 'Tab') {
      // Tab: 같은 학년의 다음 날짜, Shift+Tab: 이전 날짜 (없으면 브라우저 기본 이동)
      moveTo(findInput('date', e.shiftKey ? -1 : 1), e);
    } else if (e.key === 'ArrowDown') {
      // 목록이 떠 있으면 목록 선택, 아니면 같은 날짜의 아래 학년
      if (listShown) {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
      } else moveTo(findInput('grade', 1), e);
    } else if (e.key === 'ArrowUp') {
      if (listShown) {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
      } else moveTo(findInput('grade', -1), e);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = matches[highlight] ?? matches[0];
      if (c) choose(c);
    } else if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
      setError(null);
    }
  }

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        data-quickfill={cellKey}
        value={query}
        disabled={busy}
        placeholder={placeholder}
        title={error ?? '이름 또는 초성 입력 → ↑/↓ 선택 → Enter 저장 · Tab 다음 날짜 · ↑/↓ 학년 이동'}
        onFocus={() => {
          loadCandidates();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        className={`w-full min-w-0 rounded border bg-white px-1 outline-none focus:ring-2 focus:ring-sky-500 ${
          error ? 'border-red-500' : 'border-slate-300'
        } ${className ?? ''}`}
      />
      {open && query.trim() && (
        <ul className="absolute left-0 top-full z-30 mt-0.5 max-h-60 w-48 overflow-y-auto rounded border border-slate-300 bg-white text-sm shadow-lg print:hidden">
          {matches.map((c, i) => (
            <li
              key={c.teacherId}
              // blur보다 먼저 처리되도록 mousedown에서 선택
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-2 py-1 ${i === highlight ? 'bg-sky-600 text-white' : 'hover:bg-slate-100'}`}
            >
              <span>{c.name}</span>
              {!c.grades.includes(grade) && <span className="ml-1 text-xs opacity-70">(타 학년)</span>}
              {c.warnings.length > 0 && <span className="ml-1 text-xs opacity-80">⚠ {c.warnings.join(', ')}</span>}
            </li>
          ))}
          {candidates === null && <li className="px-2 py-1 text-xs text-slate-400">불러오는 중…</li>}
          {candidates !== null && matches.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">해당하는 교사가 없습니다.</li>}
        </ul>
      )}
      {error && <p className="whitespace-pre-line text-[11px] leading-tight text-red-600 print:hidden">{error}</p>}
    </div>
  );
}
