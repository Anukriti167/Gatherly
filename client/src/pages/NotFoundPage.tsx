import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-3 text-slate-600">The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" className="mt-8 inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700">
        Go home
      </Link>
    </div>
  );
}
