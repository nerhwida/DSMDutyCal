import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/Login';
import { ChangePinPage } from './pages/ChangePin';
import { HomePage } from './pages/Home';
import { GoogleLinkDialog } from './components/GoogleLinkDialog';

function AppRoutes() {
  const { user, loading, refresh, logout } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">로딩 중...</div>;
  }
  if (!user) {
    return <LoginPage />;
  }
  if (user.mustChangePin) {
    return <ChangePinPage onDone={refresh} />;
  }
  // 개인정보 수집에 동의하고 Google 계정을 연결해야 서비스를 쓸 수 있다. 동의하지 않으면 로그아웃.
  if (user.email === null && user.emailConsentRequired) {
    return <div className="min-h-screen bg-slate-100"><GoogleLinkDialog required onClose={logout} /></div>;
  }
  return <HomePage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
