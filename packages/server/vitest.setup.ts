// Every test worker gets a deterministic at-rest encryption key so graph/settings
// writes never fall back to creating a `.encryption-key` file inside the repo.
process.env.AGENT_WORLD_ENCRYPTION_KEY ??= "0".repeat(64);

// bcrypt (cost 12) is a deliberately slow hasher; hashing on every
// register/login in the API tests is pure CPU burn that makes the full suite
// flaky under parallel load. The auth flow under test is the API layer
// (register -> persist hash -> login -> compare -> token), not bcrypt itself,
// so stub it out for deterministic, fast test runs. Real hashing is still
// covered by any manual/integration verification against a live server.
import { vi } from "vitest";
vi.mock("bcryptjs", () => ({
  default: {
    hash: async (): Promise<string> => "$2a$12$test-hash-for-deterministic-tests",
    compare: async (): Promise<boolean> => true,
  },
}));

