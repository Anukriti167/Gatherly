import { Link } from 'react-router';
import { timeAgo } from './NotificationItem';
import { useActionItems } from './use-notifications';

/** "Needs your attention" — approvals waiting on the signed-in user across all events. */
export function ActionItemsPanel() {
  const { data: items } = useActionItems();
  if (!items?.length) return null;

  return (
    <section aria-labelledby="attention-heading" className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200">
      <h2 id="attention-heading" className="font-semibold text-amber-900">
        Needs your attention <span className="font-normal">({items.length})</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.url}>
            <Link to={item.url} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 ring-1 ring-amber-100 hover:ring-amber-300">
              <span>
                <span className="font-medium text-slate-900">{item.title}</span>
                <span className="block text-sm text-slate-600">
                  {item.eventName} · waiting {timeAgo(item.since).replace(' ago', '')}
                </span>
              </span>
              <span className="text-sm font-semibold text-brand-700">Review →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
