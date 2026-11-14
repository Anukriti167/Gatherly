import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { z } from 'zod';
import { ApiError } from './api';

type FieldErrors = Record<string, string | undefined>;

/**
 * Small form helper: validates with the same Zod schema the server uses, then merges any
 * field errors returned by the API so messages always appear next to the right input.
 */
export function useForm<S extends z.ZodObject>(schema: S, initial: z.input<S>) {
  const [values, setValues] = useState<z.input<S>>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const field = (name: keyof z.input<S> & string) => ({
    name,
    value: (values[name] as string | undefined) ?? '',
    error: errors[name],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      if (errors[name]) setErrors((errs) => ({ ...errs, [name]: undefined }));
    },
  });

  const handleSubmit = (onValid: (data: z.output<S>) => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length ? issue.path.map(String).join('.') : '_';
        next[key] ??= issue.message;
      }
      setErrors(next);
      setFormError('Please check the highlighted fields');
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onValid(parsed.data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) {
          // API keys may sit under the request wrapper ("changes.endsAt", "activity.itinerary.1.title").
          // Drop the wrapper: keep the path from the first segment that is one of this form's fields.
          const names = new Set(Object.keys(values as object));
          const next: FieldErrors = {};
          for (const [key, messages] of Object.entries(err.fields)) {
            const parts = key.split('.');
            const start = parts.findIndex((p) => names.has(p));
            next[start >= 0 ? parts.slice(start).join('.') : key] ??= messages[0];
          }
          setErrors(next);
        }
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return { values, setValues, field, errors, formError, setFormError, submitting, handleSubmit };
}
