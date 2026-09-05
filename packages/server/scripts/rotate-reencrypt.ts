/**
 * Key-rotation re-encryption CLI (design-key-rotation.md P2 runbook step 4).
 *
 * Run AFTER rotating the keyring env to `<new>,<old>` and restarting — see
 * docs/runbooks/key-rotation.md for the full procedure. Loads the keyring from
 * the same env/file precedence as the server (never passes key material on
 * the command line), converges every ciphertext column onto the new primary
 * key, and prints a residue report. Exit code is non-zero when old-key
 * ciphertext remains, so it can gate the "drop the old key" step.
 *
 * Usage:
 *   DB_FILE=/path/to/agent-world.sqlite \
 *   AGENT_WORLD_ENCRYPTION_KEYS=<new-hex>,<old-hex> \
 *   pnpm --filter @agent-world/server exec tsx scripts/rotate-reencrypt.ts \
 *     [--dry-run] [--table settings,graphs]
 */
import { reencrypt } from "../src/key-rotation.js";

const args = process.argv.slice(2);
const dryRun = args.some((a) => a === "--dry-run" || a === "--dry-run=true");
const tableArg = args.find((a) => a.startsWith("--table="))?.slice("--table=".length);
const tables = tableArg?.split(",").map((s) => s.trim()).filter(Boolean);

const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
try {
  const report = reencrypt({ dbFile, tables, dryRun });

  const width = Math.max(...report.tables.map((t) => t.table.length), "TABLE".length);
  console.log(`keyring: ${report.ringIds.join(" -> ")} (primary: ${report.primaryId})${report.dryRun ? "  [dry-run]" : ""}`);
  console.log(
    `${"TABLE".padEnd(width)}  ${"ROWS".padStart(6)}  ${"REWRITTEN".padStart(9)}  ${"V1".padStart(5)}  ${"OLD-KEY V2".padStart(10)}  ${"PLAINTEXT SEALED".padStart(16)}`,
  );
  for (const t of report.tables) {
    console.log(
      `${t.table.padEnd(width)}  ${String(t.rows).padStart(6)}  ${String(t.rewritten).padStart(9)}  ${String(t.v1).padStart(5)}  ${String(t.oldKeyV2).padStart(10)}  ${String(t.legacyPlaintextSealed).padStart(16)}`,
    );
  }
  console.log(
    `residue: v1=${report.residue.v1} old-key-v2=${report.residue.oldKeyV2}` +
      (report.residue.v1 === 0 && report.residue.oldKeyV2 === 0
        ? " — no old-key ciphertext remains; the old key can be dropped from the keyring"
        : " — old-key ciphertext REMAINS; keep the old key and inspect before dropping"),
  );
  process.exitCode =
    report.residue.v1 === 0 && report.residue.oldKeyV2 === 0 ? 0 : 1;
} catch (err) {
  console.error(`re-encryption aborted: ${(err as Error).message}`);
  process.exitCode = 1;
}
