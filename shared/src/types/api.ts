/** Shape of every API error response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation messages, keyed by dotted path. */
    fields?: Record<string, string[]>;
  };
}

/** The authenticated user as returned to the client. Never includes secrets. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  createdAt: string;
}
