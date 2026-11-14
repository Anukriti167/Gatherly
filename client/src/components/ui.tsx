import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-500/60',
  secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        buttonStyles[variant],
        className,
      )}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; name: string }) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2',
          error ? 'border-red-500 focus:ring-red-500/40' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/30',
        )}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const fieldClass = (error?: string) =>
  cx(
    'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2',
    error ? 'border-red-500 focus:ring-red-500/40' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/30',
  );

function FieldShell({ id, label, error, hint, className, children }: { id: string; label: string; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) =>
  [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

export function SelectField({
  label,
  error,
  hint,
  className,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; name: string; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={className}>
      <select id={id} {...props} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} className={fieldClass(error)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string; name: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={className}>
      <textarea id={id} rows={4} {...props} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} className={fieldClass(error)} />
    </FieldShell>
  );
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'brand' | 'green' | 'amber' | 'red'; children: ReactNode }) {
  const styles = {
    slate: 'bg-slate-100 text-slate-700',
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
  }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', styles)}>{children}</span>;
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'bg-red-50 text-red-800 ring-red-200',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    info: 'bg-brand-50 text-brand-900 ring-brand-200',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg px-4 py-3 text-sm ring-1 ring-inset', styles)}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center p-8 text-slate-500">
      <span className="size-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200', className)}>{children}</div>;
}
