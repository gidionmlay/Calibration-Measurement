import { MotionConfig } from 'framer-motion';
import { SessionProvider } from './contexts/SessionContext';
import { AppShell } from './components/shell/AppShell';

interface AppProps {
  connectivity?: 'online' | 'offline' | 'syncIssue' | 'syncConflict';
  sessionList?: 'examples' | 'empty';
}

export function App({ connectivity = 'online', sessionList = 'examples' }: AppProps) {
  return (
    <MotionConfig reducedMotion="user">
      <SessionProvider key={`${connectivity}-${sessionList}`} connectivity={connectivity} listScenario={sessionList}>
        <AppShell />
      </SessionProvider>
    </MotionConfig>);

}