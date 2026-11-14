import { useState } from 'react';
import type { ActivityDetail, ImportReport, ImportRowStatus } from '@gatherly/shared';
import { Alert, Badge, Button } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { downloadGuestTemplate } from '../../lib/download';
import { AssignmentPicker } from './AssignmentPicker';
import { useImportGuests } from './use-guests';


const STATUS: Record<ImportRowStatus, { label: string; tone: 'green' | 'red' | 'amber' | 'slate' }> = {
  ok: { label: 'Will be added', tone: 'green' },
  invalid: { label: 'Has errors', tone: 'red' },
  'duplicate-in-file': { label: 'Duplicate in file', tone: 'amber' },
  'already-on-list': { label: 'Already on list', tone: 'slate' },
};

/** Spreadsheet (CSV) import with a preview step (FR-069 – FR-071, FR-074). */
export function ImportGuests({
  eventId,
  activities,
  onDone,
  onCancel,
}: {
  eventId: string;
  activities: ActivityDetail[];
  onDone: (imported: number) => void;
  onCancel: () => void;
}) {
  const importer = useImportGuests(eventId);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [assign, setAssign] = useState({ allActivities: true, activityIds: [] as string[] });
  const [showAll, setShowAll] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const error = importer.error instanceof ApiError ? importer.error.message : importer.error ? 'Could not read the file.' : null;

  const onFile = async (file: File | undefined) => {
    setPreview(null);
    importer.reset();
    setFileError(null);
    if (!file) return;
    if (file.size > 1_000_000) {
      setCsv(null);
      setFileName('');
      setFileError('That file is larger than 1 MB. Split it into smaller files and import them one at a time.');
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setPreview(await importer.mutateAsync({ csv: text, mode: 'preview' }).catch(() => null));
  };

  const rows = preview ? (showAll ? preview.rows : preview.rows.filter((r) => r.status !== 'ok')) : [];

  return (
    <div className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div>
        <h3 className="font-semibold text-slate-900">Import guests from a spreadsheet</h3>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-600">
          <li>
            <button type="button" onClick={() => downloadGuestTemplate(activities.map((a) => a.name))} className="font-medium text-brand-700 hover:underline">
              Download the template
            </button>{' '}
            with columns <strong>Name</strong>, <strong>Email</strong>, <strong>Phone</strong> (optional) and <strong>Activities</strong> (optional).
          </li>
          <li>
            Fill it in with Excel or Google Sheets, replacing the example rows. In <strong>Activities</strong> write <strong>All</strong>, or the
            activity names separated by <strong>;</strong>
            {activities.length > 0 && (
              <>
                {' '}
                — e.g. <em>{activities.slice(0, 2).map((a) => a.name).join('; ')}</em>
              </>
            )}
            . Leave it empty to use the default you choose after uploading.
            <span className="mt-1 block rounded-md bg-amber-50 px-2 py-1 text-amber-900 ring-1 ring-amber-200">
              <strong>Spelling matters:</strong> activity names must be spelled exactly as in this event (capital letters and extra spaces don't
              matter). Misspelt names are flagged in the preview and those guests are skipped.
              {activities.length > 0 && (
                <>
                  {' '}
                  Your activities: <strong>{activities.map((a) => a.name).join(', ')}</strong>
                </>
              )}
            </span>
          </li>
          <li>
            Save it as <strong>CSV</strong> (<em>File → Save as / Download → CSV</em>) and choose it below.
          </li>
        </ol>
      </div>

      <label className="block">
        <span className="sr-only">Choose CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-brand-700"
        />
      </label>

      {importer.isPending && !preview && <p className="text-sm text-slate-500">Checking {fileName}…</p>}
      {(fileError ?? error) && <Alert>{fileError ?? error}</Alert>}

      {preview && csv && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            {(Object.keys(STATUS) as ImportRowStatus[]).map((s) =>
              preview.counts[s] ? (
                <Badge key={s} tone={STATUS[s].tone}>
                  {preview.counts[s]} {STATUS[s].label.toLowerCase()}
                </Badge>
              ) : null,
            )}
          </div>

          {rows.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg bg-white ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Invited to</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-slate-500">{r.line}</td>
                      <td className="px-3 py-2">{r.name || <span className="italic text-slate-400">blank</span>}</td>
                      <td className="px-3 py-2">{r.email || <span className="italic text-slate-400">blank</span>}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.invitedTo ? (
                          r.invitedTo.all ? (
                            'All activities'
                          ) : (
                            r.invitedTo.names.join(', ')
                          )
                        ) : r.status === 'invalid' ? (
                          '—'
                        ) : (
                          <span className="italic text-slate-500">Default (below)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        {r.errors.map((e) => (
                          <p key={e} className="mt-1 text-xs text-red-600">
                            {e}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button type="button" onClick={() => setShowAll((s) => !s)} className="text-sm font-medium text-brand-700 hover:underline">
            {showAll ? 'Show only rows needing attention' : `Show all ${preview.rows.length} rows`}
          </button>

          {preview.counts.ok > 0 ? (
            <>
              {preview.rowsUsingDefault > 0 ? (
                <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <p className="mb-2 text-sm text-slate-700">
                    <strong>{preview.rowsUsingDefault}</strong> guest{preview.rowsUsingDefault === 1 ? ' has' : 's have'} no Activities filled in. Invite{' '}
                    {preview.rowsUsingDefault === 1 ? 'them' : 'them all'} to:
                  </p>
                  <AssignmentPicker activities={activities} allActivities={assign.allActivities} activityIds={assign.activityIds} onChange={setAssign} />
                </div>
              ) : (
                <p className="text-sm text-slate-600">Every guest has their own activities from the file.</p>
              )}
              <div className="flex gap-2">
                <Button
                  loading={importer.isPending}
                  onClick={async () => {
                    const report = await importer.mutateAsync({ csv, mode: 'commit', ...assign }).catch(() => null);
                    if (report) onDone(report.imported);
                  }}
                >
                  Add {preview.counts.ok} guest{preview.counts.ok === 1 ? '' : 's'}
                </Button>
                <Button variant="secondary" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-slate-500">Rows with errors or duplicates are skipped — fix them in the file and import again.</p>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-600">No new guests to add from this file.</p>
              <Button variant="secondary" onClick={onCancel}>
                Close
              </Button>
            </div>
          )}
        </>
      )}

      {!preview && (
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}
