import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';

export interface AuthUser {
  id: number;
  name: string;
  isAdmin: boolean;
  active: boolean;
  mustChangePin: boolean;
  gradeHeadOf: number[];
}

/** 화면 표시용 역할 라벨 (예: "2학년 부장", "일반 교사"). */
export function roleLabel(user: AuthUser): string {
  if (user.isAdmin) return '관리자';
  if (user.gradeHeadOf.length > 0) return `${user.gradeHeadOf.join(', ')}학년 부장`;
  return '일반 교사';
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (teacherId: number, pin: string) => Promise<{ mustChangePin: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<AuthUser>('/api/auth/me');
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (teacherId: number, pin: string) => {
      const result = await api.post<{ ok: true; mustChangePin: boolean }>('/api/auth/login', {
        teacherId,
        pin,
      });
      await refresh();
      return { mustChangePin: result.mustChangePin };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
