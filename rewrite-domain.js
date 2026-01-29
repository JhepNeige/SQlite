const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ----------------------
// arguments
// ----------------------

const DB_PATH = process.argv[2];
const OLD_DOMAIN = process.argv[3];
const NEW_DOMAIN = process.argv[4];

if (!DB_PATH || !OLD_DOMAIN || !NEW_DOMAIN) {
  console.error(
    "Usage: node rewrite-domain.js places.sqlite old.domain new.domain"
  );
  process.exit(1);
}

// ----------------------
// backup
// ----------------------

function backupPlaces(dbPath) {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);

  const uid = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(dir, `backup-${uid}`);

  fs.mkdirSync(backupDir);

  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith(base)) {
      fs.copyFileSync(
        path.join(dir, file),
        path.join(backupDir, file)
      );
    }
  }

  console.log(`Backup créé : ${backupDir}`);
}

backupPlaces(DB_PATH);

// ----------------------
// ouverture DB
// ----------------------

const db = new Database(DB_PATH);

// ----------------------
// sélection URLs
// ----------------------

const selectStmt = db.prepare(`
  SELECT id, url
  FROM moz_places
  WHERE url LIKE ?
`);

const rows = selectStmt.all(`%://${OLD_DOMAIN}%`);

if (rows.length === 0) {
  console.log("Aucune URL à corriger.");
  db.close();
  process.exit(0);
}

console.log(`${rows.length} URL(s) à corriger`);

// ----------------------
// update
// ----------------------

const updateStmt = db.prepare(`
  UPDATE moz_places
  SET url = ?
  WHERE id = ?
`);

const tx = db.transaction(() => {
  for (const row of rows) {
    const newUrl = row.url.replace(
      `://${OLD_DOMAIN}`,
      `://${NEW_DOMAIN}`
    );

    updateStmt.run(newUrl, row.id);
  }
});

tx();

db.close();

console.log("Correction terminée.");
