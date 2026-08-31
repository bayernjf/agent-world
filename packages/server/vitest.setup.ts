// Every test worker gets a deterministic at-rest encryption key so graph/settings
// writes never fall back to creating a `.encryption-key` file inside the repo.
process.env.AGENT_WORLD_ENCRYPTION_KEY ??= "0".repeat(64);
