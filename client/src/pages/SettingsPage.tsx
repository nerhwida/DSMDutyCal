import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatDateTime } from '../lib/date';

interface RestoreStatus {
  pendingRestore: boolean;
  stagedAt?: string;
  size?: number;
}

interface MonthlyBackup {
  fileName: string;
  month: string; // 'YYYY-MM' (백업 대상 월)
  size: number;
  createdAt: string;
}

interface RestoreResult {
  teachers: number;
  assignments: number;
  migrations: number;
  pendingMigrations: number;
  autoRestart: boolean;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

/** 설정 (ADMIN): DB 백업 다운로드·복원 (F11). */
export function SettingsPage() {
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [monthly, setMonthly] = useState<MonthlyBackup[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pin, setPin] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([
        api.get<RestoreStatus>('/api/backup/restore'),
        api.get<MonthlyBackup[]>('/api/backup/monthly'),
      ]);
      setStatus(s);
      setMonthly(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function download(url = '/api/backup') {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new Error(body?.error ?? '백업을 만들지 못했습니다.');
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'dutycal-backup.db';
      const objectUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = name;
      a.click();
      URL.revokeObjectURL(objectUrl);
      setMessage(`백업 파일(${name})을 내려받았습니다. 안전한 곳에 보관하세요.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '백업에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!file) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Admin-Pin': pin },
        body: file,
      });
      const body = await res.json().catch(() => undefined);
      if (!res.ok) throw new ApiError(res.status, body?.error ?? '복원 준비에 실패했습니다.', body);
      setResult(body as RestoreResult);
      setFile(null);
      setPin('');
      setUnderstood(false);
      await loadStatus().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : '복원 준비에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setError(null);
    try {
      await api.delete('/api/backup/restore');
      setResult(null);
      setMessage('대기 중이던 복원을 취소했습니다.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '취소에 실패했습니다.');
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-base font-semibold text-slate-800">설정</h2>
      {error && <p className="whitespace-pre-line text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">데이터 백업</h3>
        <p className="text-xs text-slate-500">
          교사·배정·이력 등 모든 데이터를 파일 하나(SQLite DB)로 내려받습니다. 서비스 중에도 안전하게 만들 수 있습니다.
          정기적으로(예: 월 마감 후) 내려받아 학교 공유 드라이브 등에 보관하세요.
        </p>
        <button onClick={() => download()} disabled={busy} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          백업 파일 내려받기
        </button>
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">월초 자동 백업</h3>
        <p className="text-xs text-slate-500">
          매달 1일에 전월 기준 백업이 서버에 자동으로 만들어집니다 (기본 최근 24개월분 보관). 복원하려면 내려받은 뒤
          아래 "백업에서 복원"에 올리세요.
        </p>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
          {monthly.map((b) => (
            <li key={b.fileName} className="flex items-center justify-between px-3 py-1.5">
              <span>
                {Number(b.month.slice(0, 4))}년 {Number(b.month.slice(5, 7))}월분
                <span className="ml-2 text-xs text-slate-400">
                  {formatSize(b.size)} · {formatDateTime(b.createdAt)} 생성
                </span>
              </span>
              <button
                onClick={() => download(`/api/backup/monthly/${b.fileName}`)}
                disabled={busy}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                내려받기
              </button>
            </li>
          ))}
          {monthly.length === 0 && (
            <li className="px-3 py-3 text-center text-xs text-slate-400">아직 자동 백업이 없습니다. 다음 달 1일에 만들어집니다.</li>
          )}
        </ul>
      </section>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">백업에서 복원</h3>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-500">
          <li>현재 데이터 전체가 백업 파일 내용으로 <b>대체</b>됩니다. 백업 이후의 변경은 사라집니다.</li>
          <li>복원은 서버가 다시 시작될 때 적용되며, 적용 직전의 데이터는 서버의 backups 폴더에 자동 보관됩니다.</li>
          <li>이전 버전에서 만든 백업도 복원 후 최신 구조로 자동 변환됩니다.</li>
        </ul>

        {status?.pendingRestore ? (
          <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              복원 대기 중 ({status.size !== undefined && formatSize(status.size)}
              {status.stagedAt && `, ${formatDateTime(status.stagedAt)} 업로드`}) — 서버가 다시 시작되면 적용됩니다.
            </p>
            {result && !result.autoRestart && (
              <p className="text-xs">
                지금 서버를 다시 시작하세요. (Docker: <code>docker compose restart</code>, 개발 환경: 서버를 껐다 켠 뒤
                <code> npx prisma migrate deploy</code>)
              </p>
            )}
            {result?.autoRestart && <p className="text-xs">서버가 자동으로 다시 시작됩니다. 잠시 후 다시 로그인해주세요.</p>}
            <button onClick={cancel} className="rounded border border-amber-500 px-2 py-1 text-xs hover:bg-amber-100">
              복원 취소
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="file"
              accept=".db,application/octet-stream"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm"
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder="관리자 PIN 재입력"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-48 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              현재 데이터가 선택한 백업으로 대체된다는 것을 이해했습니다.
            </label>
            <button
              onClick={restore}
              disabled={busy || !file || pin.length < 4 || !understood}
              className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              복원 준비
            </button>
          </div>
        )}

        {result && (
          <p className="text-xs text-slate-600">
            검증 완료: 교사 {result.teachers}명, 배정 {result.assignments}건
            {result.pendingMigrations > 0 && ` · 적용 시 구조 업데이트 ${result.pendingMigrations}건`}
          </p>
        )}
      </section>
    </div>
  );
}
