import { MotionConfig } from 'framer-motion';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SessionProvider } from './contexts/SessionContext';
import { AppShell } from './components/shell/AppShell';
import { AuthModal } from './components/auth/AuthModal';
import { AuthScreen } from './components/auth/AuthScreen';
import type { SystemRoleName } from './services/auth/types';

interface AppProps {
  connectivity?: 'online' | 'offline' | 'syncIssue' | 'syncConflict';
  sessionList?: 'examples' | 'empty';
  defaultMockRole?: SystemRoleName;
  forceMock?: boolean;
}

function MainContent({
  connectivity,
  sessionList,
}: {
  connectivity: 'online' | 'offline' | 'syncIssue' | 'syncConflict';
  sessionList: 'examples' | 'empty';
}) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          <p className="text-sm font-medium text-sub">Loading calibration workspace...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen initialTab="register" />;
  }

  return (
    <SessionProvider key={`${connectivity}-${sessionList}`} connectivity={connectivity} listScenario={sessionList}>
      <AppShell />
      <AuthModal />
    </SessionProvider>
  );
}

export function App({
  connectivity = 'online',
  sessionList = 'empty',
  defaultMockRole,
  forceMock,
}: AppProps) {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider defaultMockRole={defaultMockRole} forceMock={forceMock}>
        <MainContent connectivity={connectivity} sessionList={sessionList} />
      </AuthProvider>
    </MotionConfig>
  );
}
