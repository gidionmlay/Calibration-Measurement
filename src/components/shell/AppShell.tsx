import { useState } from 'react';
import { Toaster } from 'sonner';
import { useSession } from '../../contexts/SessionContext';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { WorkflowStepper } from './WorkflowStepper';
import { SessionBanners } from './SessionBanners';
import { SyncDialog } from './SyncDialog';
import { SessionList } from '../../pages/SessionList';
import { SessionSetup } from '../../pages/SessionSetup';
import { PreCalibration } from '../../pages/PreCalibration';
import { CourseDistance } from '../../pages/CourseDistance';
import { PostCalibration } from '../../pages/PostCalibration';
import { FinalReview } from '../../pages/FinalReview';

export function AppShell() {
  const { view, active } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const inSession = view !== 'list' && !!active;

  const page = {
    list: <SessionList />,
    setup: <SessionSetup />,
    pre: <PreCalibration />,
    distance: <CourseDistance />,
    post: <PostCalibration />,
    review: <FinalReview />
  }[view];

  return (
    <div className="min-h-screen w-full bg-canvas font-sans text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Header onMenu={() => setNavOpen(true)} />
      <div className="flex">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <main id="main" className="min-w-0 flex-1">
          {inSession &&
          <div className="border-b border-line bg-panel px-4 py-3 md:px-8">
              <WorkflowStepper />
            </div>
          }
          <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 md:px-8 md:pt-8">
            <SessionBanners />
            {page}
            {view === 'list' && <div className="h-10" />}
          </div>
        </main>
      </div>
      <SyncDialog />
      <Toaster position="top-right" offset={72} toastOptions={{ style: { borderRadius: 4, border: '1px solid #c9c9c9', boxShadow: 'none', fontFamily: 'Inter, sans-serif' } }} />
    </div>);

}