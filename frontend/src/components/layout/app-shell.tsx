import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, Moon, PhoneCall, Sun, Trophy, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UploadDialog } from '@/components/upload/upload-dialog';
import { useReadiness } from '@/hooks/use-api';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: BarChart3 },
  { to: '/calls', label: 'Calls', icon: PhoneCall },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
];

/**
 * Application shell: a persistent sidebar on desktop that collapses to a top
 * tab bar on small screens. Replaces the original single scrolling column of
 * bordered divs.
 */
export function AppShell() {
  const { theme, toggle } = useTheme();
  const [uploadOpen, setUploadOpen] = useState(false);
  const readiness = useReadiness();
  const uploadsEnabled = readiness.data?.checks.llm === 'configured';

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <aside className="border-b border-border bg-card md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 p-4 md:block">
          <div>
            <p className="text-sm font-semibold tracking-tight">Call Intelligence</p>
            <p className="text-xs text-muted-foreground">Sales coaching dashboard</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="md:hidden"
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-secondary-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:mt-4 md:block md:px-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setUploadOpen(true)}
            title={
              uploadsEnabled
                ? 'Analyze a new transcript'
                : 'Analysis is disabled: the server has no API key configured'
            }
          >
            <Upload />
            Analyze transcript
          </Button>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Theme</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl p-4 md:p-6">
          <div className="mb-4 flex justify-end md:hidden">
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload />
              Analyze transcript
            </Button>
          </div>
          <Outlet />
        </div>
      </main>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        uploadsEnabled={uploadsEnabled}
      />
    </div>
  );
}
