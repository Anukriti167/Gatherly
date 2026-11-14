import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useCurrentUser, useLogout } from '../features/auth/use-auth';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { Button, Spinner } from './ui';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
      <img src="/favicon.svg" alt="" className="size-7" />
      Gatherly
    </Link>
  );
}

function SkipLink() {
  return (
    <a href="#main" className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
      Skip to content
    </a>
  );
}

/** Marketing / public pages. */
export function PublicLayout() {
  const { data: user } = useCurrentUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            {user ? (
              <Link to="/dashboard" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} Gatherly
      </footer>
    </div>
  );
}

/** Centered card for sign-in / sign-up flows. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-20">
      <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`;

/** Authenticated application shell. Redirects to sign-in when there is no session. */
export function AppLayout() {
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  if (isPending) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav aria-label="Main" className="hidden gap-1 sm:flex">
              <NavLink to="/dashboard" className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/profile" className={navLinkClass}>
                Profile
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="hidden text-sm text-slate-600 md:inline">{user.name}</span>
            <Button
              variant="secondary"
              loading={logout.isPending}
              onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}
            >
              Sign out
            </Button>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 border-t border-slate-100 px-4 py-2 sm:hidden">
          <NavLink to="/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/profile" className={navLinkClass}>
            Profile
          </NavLink>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

/** Wraps sign-in/up pages: already signed-in users go straight to the dashboard. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { data: user, isPending } = useCurrentUser();
  if (isPending) return <Spinner />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Only allow same-site relative redirects (prevents open-redirects via ?next=). */
export function safeNext(next: string | null, fallback = '/dashboard'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
