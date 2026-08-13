import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { CallDetailPage } from '@/pages/call-detail-page';
import { CallsPage } from '@/pages/calls-page';
import { LeaderboardPage } from '@/pages/leaderboard-page';
import { OverviewPage } from '@/pages/overview-page';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/calls/:id" element={<CallDetailPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
