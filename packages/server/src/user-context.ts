import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-async-context user identity. Concurrent runs of different owners carry
 * their own userId through every await (AsyncLocalStorage tracks the promise
 * chain), so provider/model config resolution stays tenant-scoped even though
 * the routing worker is a shared singleton.
 */
const store = new AsyncLocalStorage<string | undefined>();

export function runAsUser(userId: string, fn: () => Promise<void>): Promise<void> {
  return store.run(userId, fn);
}

export function currentUserId(): string | undefined {
  return store.getStore();
}
