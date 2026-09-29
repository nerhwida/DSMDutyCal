import { useState } from 'react';
import { roleLabel, useAuth } from '../auth/AuthContext';
import { NotificationBell } from '../components/NotificationBell';
import { CalendarPage } from './CalendarPage';
import { MyDutyPage } from './MyDutyPage';
import { StatsPage } from './StatsPage';
import { HistoryPage } from './HistoryPage';
import { TeacherManagementPage } from './TeacherManagementPage';
import { SpecialDaysPage } from './SpecialDaysPage';
import { InitialCountsPage } from './InitialCountsPage';
import { ApiClientsPage } from './ApiClientsPage';

type Tab =
  | 'calendar'
  | 'my-duty'
  | 'stats'
  | 'history'
  | 'teachers'
  | 'special-days'
  | 'initial-counts'
  | 'api-clients';

export function HomePage() {
  const { user, logout } = useAuth();
  const canManageTeachers = !!user && (user.isAdmin || user.gradeHeadOf.length > 0);
  // F1-3: 일반 교사는 '내 감독'이 기본 진입 화면, 학년부장·ADMIN은 달력.
  const [tab, setTab] = useState<Tab>(canManageTeachers ? 'calendar' : 'my-duty');
  if (!user) return null;

  const tabs: { key: Tab; label: string; visible: boolean }[] = [
    { key: 'calendar', label: '월간 달력', visible: true },
    { key: 'my-duty', label: '내 감독', visible: true },
    { key: 'stats', label: '통계', visible: true },
    { key: 'history', label: '변경 이력', visible: true },
    { key: 'teachers', label: '교사 관리', visible: canManageTeachers },
    { key: 'special-days', label: '일정 관리', visible: true },
    { key: 'initial-counts', label: '초기 누계', visible: user.isAdmin },
    { key: 'api-clients', label: 'API 연동', visible: user.isAdmin },
  ];

  return (
    <div className="min-h-screen bg-slate-50 print:min-h-0 print:bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 print:hidden">
        <span className="text-sm font-medium text-slate-700">
          {user.name} 선생님 ({roleLabel(user)})
        </span>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            onClick={() => logout()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            로그아웃
          </button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-200 bg-white px-6 print:hidden">
        {tabs
          .filter((t) => t.visible)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-3 py-2 text-sm ${
                tab === t.key
                  ? 'border-slate-800 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
      </nav>

      <main className="p-6 print:p-0">
        {tab === 'calendar' && <CalendarPage />}
        {tab === 'my-duty' && <MyDutyPage />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'teachers' && canManageTeachers && <TeacherManagementPage />}
        {tab === 'special-days' && <SpecialDaysPage />}
        {tab === 'initial-counts' && user.isAdmin && <InitialCountsPage />}
        {tab === 'api-clients' && user.isAdmin && <ApiClientsPage />}
      </main>
    </div>
  );
}
