import { createBrowserRouter } from 'react-router';
import { AppLayout, GuestOnly, PublicLayout } from './components/layouts';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { CreateEventPage } from './pages/events/CreateEventPage';
import { EventPage } from './pages/events/EventPage';
import { GuestEventPage } from './pages/guest/GuestEventPage';
import { InvitationLandingPage } from './pages/guest/InvitationLandingPage';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';

export const router = createBrowserRouter([
  // Guest website — no account, own minimal layout (FR-087, FR-094).
  { path: 'i/:token', element: <InvitationLandingPage /> },
  { path: 'my-event', element: <GuestEventPage /> },
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'login', element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: 'register', element: <GuestOnly><RegisterPage /></GuestOnly> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'events/new', element: <CreateEventPage /> },
      { path: 'events/:eventId', element: <EventPage /> },
    ],
  },
]);
