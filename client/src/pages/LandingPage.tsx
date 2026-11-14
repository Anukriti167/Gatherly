import { Link } from 'react-router';

const FEATURES = [
  {
    title: 'One event, many activities',
    body: 'Plan a wedding weekend, a summit or a birthday with separate schedules, venues, menus and dress codes for every activity.',
  },
  {
    title: 'A personal website for every guest',
    body: 'Guests open a secure link — no sign-up needed — and see only the activities they are invited to, with their own itinerary.',
  },
  {
    title: 'Decide together',
    body: 'Co-hosts approve publication and every change unanimously, with a full history of proposals, objections and revisions.',
  },
  {
    title: 'RSVPs, updates and photos',
    body: 'Track RSVPs per activity, send announcements, collect guest suggestions and share a moderated photo gallery.',
  },
];

/** FR-206, FR-207 — full landing page and contact form (FR-208 – FR-210) arrive in a later phase. */
export function LandingPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Plan gatherings together. Give every guest their own event website.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            Gatherly helps families, creators and small businesses organise multi-activity events — from the first draft to the
            last photo.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Link to="/register" className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-brand-700">
              Start planning — it's free
            </Link>
            <Link to="/login" className="rounded-lg bg-white px-6 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
              Sign in
            </Link>
          </div>
        </div>
      </section>
      <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="features" className="sr-only">
          Features
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
