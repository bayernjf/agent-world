/**
 * Owner-side password reset CLI.
 *
 * Provisioned accounts (POST /api/admin/users) receive a one-time password that
 * is delivered out-of-band; agent-world has no SMTP and no self-serve reset, so
 * a holder who loses that password is locked out until an operator hands them a
 * new one. This script is that operator action: it writes a fresh one-time
 * password and re-arms must_change_password = 1 (same contract as provisioning).
 *
 * The password is never read from argv by default — argv leaks into shell
 * history and `ps`, the same reason rotate-reencrypt.ts never takes key material
 * on the command line. By default a random 16-char password is generated and
 * printed once for the operator to relay. `--password=` exists for scripted
 * flows but is not the recommended path.
 *
 * Usage:
 *   DB_FILE=/var/lib/agent-world/agent-world.sqlite \
 *   pnpm --filter @agent-world/server reset:password -- --email user@example.com
 *   ... --id=<userId>          # target by id instead of email
 *   ... --password=<value>     # set a specific password (avoid: leaks to `ps`)
 *   ... --db=/path/to.sqlite   # explicit file (overrides DB_FILE)
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { openDb } from "../src/db.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

const email = flag("--email");
const id = flag("--id");
const explicitPassword = flag("--password");
const dbFile = resolve(flag("--db") ?? process.env.DB_FILE ?? "agent-world.sqlite");

if ((!email && !id) || (email && id)) {
  console.error(
    "usage: reset:password -- --email=<email> | --id=<userId> [--password=<value>] [--db=<file>]",
  );
  process.exit(2);
}
// node:sqlite would happily create a missing file, so a typo'd path would look
// like "account not found" instead of failing loudly (see scripts/sqlite-ops-db.ts).
if (!existsSync(dbFile)) {
  console.error(
    `no database at ${dbFile}. Set --db/DB_FILE to the real file rather than letting this create an empty one.`,
  );
  process.exit(1);
}

const db = openDb(dbFile);

try {
  const user = email ? await db.findUserByEmail(email) : await db.findUserById(id as string);
  if (!user) {
    console.error(`no account for ${email ? `email ${email}` : `id ${id}`} in ${dbFile}`);
    process.exitCode = 1;
  } else if (user.is_demo === 1) {
    console.error(
      `${user.email} is a demo account (is_demo=1) — nobody holds its password, so there is nothing to reset. ` +
        `Let the holder claim it, or prune it.`,
    );
    process.exitCode = 1;
  } else {
    // 12 random bytes, base64url — 16 chars, the same one-time format as the
    // provision route (index.ts POST /api/admin/users).
    const password = explicitPassword ?? randomBytes(12).toString("base64url");
    // Cost 12 mirrors auth.ts hashPassword. bcrypt.compare reads the cost from
    // the stored hash, so existing hashes still verify even if that drifts.
    await db.adminResetUserPassword(user.id, await bcrypt.hash(password, 12));

    console.log(`source: ${dbFile}`);
    console.log(`reset: ${user.email} (${user.id}, role=${user.role})`);
    console.log(`one-time password: ${password}`);
    console.log("must_change_password=1 — the holder is forced to replace it at next login.");
    if (!explicitPassword) console.log("(shown once; relay it over a trusted channel.)");
    console.log(
      "note: existing JWT sessions are NOT revoked by this reset — rotate JWT_SECRET and restart to kick them.",
    );
  }
} catch (err) {
  console.error(`password reset aborted: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
