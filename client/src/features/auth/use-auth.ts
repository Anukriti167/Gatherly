import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser, LoginInput, RegisterInput, UpdateProfileInput } from '@gatherly/shared';
import { api, ApiError } from '../../lib/api';

export const currentUserKey = ['auth', 'me'] as const;

/** The signed-in user, or `null` when signed out. */
export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: async (): Promise<CurrentUser | null> => {
      try {
        const { user } = await api.get<{ user: CurrentUser }>('/auth/me');
        return user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: CurrentUser }>('/auth/login', input),
    onSuccess: ({ user }) => qc.setQueryData(currentUserKey, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<{ user: CurrentUser }>('/auth/register', input),
    onSuccess: ({ user }) => qc.setQueryData(currentUserKey, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(currentUserKey, null);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch<{ user: CurrentUser }>('/users/me', input),
    onSuccess: ({ user }) => qc.setQueryData(currentUserKey, user),
  });
}
