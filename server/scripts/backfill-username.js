"use strict";

// One-off migration: assign the pre-multi-tenant games/pending/profile rows
// (which have no owner) to an explicit username. Safe to run at most once —
// refuses if any ownership data already exists. Safe to re-run after success
// as a no-op check (it'll just report nothing left to do).
//
// Usage: node server/scripts/backfill-username.js --username=<name>
//    or: PRIMARY_USERNAME=<name> node server/scripts/backfill-username.js

const { db } = require("../db");

function getUsername() {
  const arg = process.argv.find(a => a.startsWith("--username="));
  const username = arg ? arg.slice("--username=".length) : process.env.PRIMARY_USERNAME;
  if (!username) {
    console.error("Usage: node server/scripts/backfill-username.js --username=<name>");
    console.error("   or: PRIMARY_USERNAME=<name> node server/scripts/backfill-username.js");
    process.exit(1);
  }
  return username;
}

function main() {
  const username = getUsername();

  const ownedGames   = db.prepare("SELECT COUNT(*) AS n FROM games WHERE username IS NOT NULL").get().n;
  const ownedPending = db.prepare("SELECT COUNT(*) AS n FROM pending WHERE username IS NOT NULL").get().n;
  const profileRows  = db.prepare("SELECT COUNT(*) AS n FROM profile").get().n;

  if (ownedGames > 0 || ownedPending > 0 || profileRows > 0) {
    console.error(
      "[backfill] Refusing to run: ownership data already exists " +
      `(games with username: ${ownedGames}, pending with username: ${ownedPending}, profile rows: ${profileRows}). ` +
      "This script is safe to run at most once."
    );
    process.exit(1);
  }

  const hasProfileOld = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='profile_old'"
  ).get();

  const run = db.transaction(() => {
    const gamesResult   = db.prepare("UPDATE games SET username = ? WHERE username IS NULL").run(username);
    const pendingResult = db.prepare("UPDATE pending SET username = ? WHERE username IS NULL").run(username);

    let profileMigrated = 0;
    if (hasProfileOld) {
      const oldRow = db.prepare("SELECT content FROM profile_old WHERE id = 1").get();
      if (oldRow) {
        db.prepare("INSERT INTO profile (username, content) VALUES (?, ?)").run(username, oldRow.content);
        profileMigrated = 1;
      }
      db.exec("DROP TABLE profile_old");
    }

    return {
      games: gamesResult.changes,
      pending: pendingResult.changes,
      profile: profileMigrated,
    };
  })();

  console.log(`[backfill] Assigned to username "${username}":`);
  console.log(`  games:   ${run.games}`);
  console.log(`  pending: ${run.pending}`);
  console.log(`  profile: ${run.profile}`);
}

main();
