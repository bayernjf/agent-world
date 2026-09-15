import { create } from "zustand";

/** Demo quota mirror of the server's DEMO_QUOTA (design-demo-user §6.2). */
export interface DemoQuota {
  tokens: number;
  maxRunsTotal: number;
  concurrentRuns: number;
  storageBytes: number;
  videoSegments: number;
}

export interface DemoInfo {
  expiresAt: string;
  quota: DemoQuota;
}

/** The /api/auth/me user, extended with the demo flag block. */
export interface SessionUser {
  id: string;
  email: string;
  role?: string;
  createdAt?: string;
  isDemo?: boolean;
  demo?: DemoInfo | null;
}

/** Why the claim dialog was opened — drives its copy. */
export type ClaimReason = "manual" | "locked" | "quota";

interface SessionState {
  user: SessionUser | null;
  /** True once the first /me probe has resolved (avoids flash of login). */
  loaded: boolean;
  claimOpen: boolean;
  claimReason: ClaimReason;
  setSession: (user: SessionUser | null) => void;
  /** Re-fetch /api/auth/me and store the result; returns the user (or null on 401). */
  refresh: () => Promise<SessionUser | null>;
  clear: () => void;
  openClaim: (reason?: ClaimReason) => void;
  closeClaim: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  loaded: false,
  claimOpen: false,
  claimReason: "manual",
  setSession: (user) => set({ user, loaded: true }),
  refresh: async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) {
        set({ user: null, loaded: true });
        return null;
      }
      const data = (await res.json()) as { user: SessionUser };
      set({ user: data.user, loaded: true });
      return data.user;
    } catch {
      set({ loaded: true });
      return null;
    }
  },
  clear: () => set({ user: null, claimOpen: false }),
  openClaim: (reason = "manual") => set({ claimOpen: true, claimReason: reason }),
  closeClaim: () => set({ claimOpen: false }),
}));

/**
 * Read a structured demo block (DEMO_LOCKED / DEMO_QUOTA_*) out of the web
 * client's `Error("<status> <body>")` (see lib/api.ts `json`). Returns the
 * reason code, or null for any other error.
 */
export function parseDemoError(err: unknown): ClaimReason | null {
  if (!(err instanceof Error)) return null;
  const m = /^(402|403)\s+([\s\S]+)$/.exec(err.message);
  if (!m) return null;
  try {
    const body = JSON.parse(m[2]!) as { code?: string; error?: string };
    if (body.code === "DEMO_LOCKED" || body.error === "demo_forbidden") return "locked";
    if (typeof body.code === "string" && body.code.startsWith("DEMO_QUOTA")) return "quota";
    return null;
  } catch {
    return null;
  }
}

/** Unused-state guard so callers can select without subscribing to the whole store. */
export function getSessionUser(): SessionUser | null {
  return useSession.getState().user;
}
