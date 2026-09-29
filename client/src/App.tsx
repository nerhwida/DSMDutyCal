import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/Login';
import { ChangePinPage } from './pages/ChangePin';
import { HomePage } from './pages/Home';

function AppRoutes() {
  const { user, loading, refresh } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">로딩 중...</div>;
  }
  if (!user) {
    return <LoginPage />;
  }
  if (user.mustChangePin) {
    return <ChangePinPage onDone={refresh} />;
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
