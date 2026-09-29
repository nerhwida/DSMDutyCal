import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatDateTime } from '../lib/date';

interface ApiClient {
  id: number;
  name: string;
  keyPrefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: { name: string };
}

/** API 연동 계정 관리 (ADMIN). 연동 계정 키로는 감독표 배포 API만 호출할 수 있다. */
export function ApiClientsPage() {
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClients(await api.get<ApiClient[]>('/api/api-clients'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리에 실패했습니다.');
    }
  }

  function showKey(clientName: string, key: string) {
    setIssued({ name: clientName, key });
    setCopied(false);
  }

  const create = () =>
    run(async () => {
      const res = await api.post<{ client: ApiClient; key: string }>('/api/api-clients', { name });
      showKey(res.client.name, res.key);
      setName('');
    });

  const regenerate = (c: ApiClient) => {
    if (!window.confirm(`'${c.name}'의 키를 재발급할까요? 기존 키는 즉시 사용할 수 없게 됩니다.`)) return;
    run(async () => {
      const res = await api.post<{ client: ApiClient; key: string }>(`/api/api-clients/${c.id}/regenerate`);
      showKey(res.client.name, res.key);
    });
  };

  const remove = (c: ApiClient) => {
    if (!window.confirm(`'${c.name}' 연동 계정을 삭제할까요? 이 키로는 더 이상 조회할 수 없습니다.`)) return;
    run(() => api.delete(`/api/api-clients/${c.id}`));
  };

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      setError('클립보드 복사에 실패했습니다. 키를 직접 선택해 복사해주세요.');
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-800">API 연동 계정</h2>
        <p className="mt-1 text-xs text-slate-500">
          학교 홈페이지·메신저 봇 등 외부 시스템이 월별 감독표를 조회할 때 쓰는 조회 전용 계정입니다. 연동 계정 키로는
          감독표 배포 API만 호출할 수 있고, 앱 로그인이나 다른 기능은 사용할 수 없습니다.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-end gap-2 rounded border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs text-slate-500">연동 계정 이름</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 학교 홈페이지"
            className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={create}
          disabled={!name.trim()}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          계정 만들기
        </button>
      </div>

      {issued && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">
            '{issued.name}' API 키가 발급되었습니다. 이 키는 지금 한 번만 표시되니 안전한 곳에 보관하세요.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-800">
              {issued.key}
            </code>
            <button onClick={copy} className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100">
              {copied ? '복사됨 ✓' : '복사'}
            </button>
            <button onClick={() => setIssued(null)} className="text-xs text-amber-800 underline">
              닫기
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">이름</th>
              <th className="px-3 py-2 text-left">키</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">마지막 사용</th>
              <th className="px-3 py-2 text-left">만든 사람 · 일시</th>
              <th className="px-3 py-2 text-left">관리</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.keyPrefix}…</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 text-xs ${c.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                    {c.active ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{c.lastUsedAt ? formatDateTime(c.lastUsedAt) : '-'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {c.createdBy.name} · {formatDateTime(c.createdAt)}
                </td>
                <td className="space-x-2 px-3 py-2 text-xs">
                  <button className="underline" onClick={() => regenerate(c)}>
                    재발급
                  </button>
                  <button className="underline" onClick={() => run(() => api.put(`/api/api-clients/${c.id}`, { active: !c.active }))}>
                    {c.active ? '비활성화' : '활성화'}
                  </button>
                  <button className="text-red-600 underline" onClick={() => remove(c)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-400">
                  등록된 연동 계정이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-200 bg-white p-4 text-xs text-slate-600">
        <p className="mb-1 font-medium text-slate-700">호출 방법</p>
        <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono">{`GET /api/public/duty/{연도}/{월}
X-API-Key: <발급받은 키>`}</pre>
        <p className="mt-1">확정·마감된 학년만 공개되며, 미리보기(편성 중) 학년은 null로 내려갑니다.</p>
      </div>
    </div>
  );
}
