const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ----------------------
// paramètres génériques
// ----------------------

const SOURCE_DB = process.argv[2];
const ARCHIVE_DB = process.argv[3];
const DELETE_MODE = process.argv.includes("/delete");

const PRIMARY = "moz_places";
const SECONDARY = "moz_bookmarks";
const JOIN_KEY = "fk";
const FILTER = "moz_places.url LIKE '%www.domain.com%'";

if (!SOURCE_DB || !ARCHIVE_DB) {
  console.error("Usage: node archive.js source.sqlite archive.sqlite [/delete]");
  process.exit(1);
}

// ----------------------
// helpers
// ----------------------

function getTableInfo(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function schemaSignature(columns) {
  return columns.map(c => `${c.name}:${c.type || ""}`).join("|");
}

function nextArchiveName(base) {
  if (!fs.existsSync(base)) return base;

  const ext = path.extname(base);
  const name = path.basename(base, ext);
  const dir = path.dirname(base);

  let i = 1;
  while (true) {
    const candidate = path.join(dir, `${name}_${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    i++;
  }
}

function validateFilter(filter) {
  const forbidden = /(drop|alter|pragma|attach|detach)\s+/i;
  if (forbidden.test(filter)) {
    throw new Error("Filtre SQL dangereux détecté");
  }
}

function backupSourceFiles(sourcePath) {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath);

  const uid = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

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

// ----------------------
// validation filtre
// ----------------------

validateFilter(FILTER);

// ----------------------
// backup si delete
// ----------------------

if (DELETE_MODE) {
  console.log("Mode /delete activé");
  backupSourceFiles(SOURCE_DB);
}

// ----------------------
// ouverture source
// ----------------------

const sourceDb = new Database(SOURCE_DB, {
  readonly: !DELETE_MODE
});

// ----------------------
// introspection schéma
// ----------------------

const primaryCols = getTableInfo(sourceDb, PRIMARY);
const secondaryCols = getTableInfo(sourceDb, SECONDARY);

if (!primaryCols.length || !secondaryCols.length) {
  throw new Error("Tables primaires ou secondaires introuvables");
}

// ----------------------
// ouverture archive
// ----------------------

let archivePath = ARCHIVE_DB;
let archiveDb;

if (fs.existsSync(ARCHIVE_DB)) {
  archiveDb = new Database(ARCHIVE_DB);

  const ap = getTableInfo(archiveDb, PRIMARY);
  const as = getTableInfo(archiveDb, SECONDARY);

  if (
    schemaSignature(ap) !== schemaSignature(primaryCols) ||
    schemaSignature(as) !== schemaSignature(secondaryCols)
  ) {
    archiveDb.close();
    archivePath = nextArchiveName(ARCHIVE_DB);
    archiveDb = new Database(archivePath);
  }
} else {
  archiveDb = new Database(ARCHIVE_DB);
}

// ----------------------
// création tables archive
// ----------------------

function createTable(db, table, cols) {
  const colsSql = cols
    .map(c => `"${c.name}" ${c.type || ""}`)
    .join(", ");

  db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${colsSql})`);
}

createTable(archiveDb, PRIMARY, primaryCols);
createTable(archiveDb, SECONDARY, secondaryCols);

// ----------------------
// requêtes dynamiques
// ----------------------

const primaryNames = primaryCols.map(c => `"${c.name}"`).join(", ");
const secondaryNames = secondaryCols.map(c => `"${c.name}"`).join(", ");

const selectPrimary = sourceDb.prepare(`
  SELECT ${primaryNames}
  FROM ${PRIMARY}
  WHERE ${FILTER}
`);

const selectSecondary = sourceDb.prepare(`
  SELECT ${secondaryNames}
  FROM ${SECONDARY}
  WHERE ${JOIN_KEY} = ?
`);

const insertPrimary = archiveDb.prepare(`
  INSERT INTO ${PRIMARY} (${primaryNames})
  VALUES (${primaryCols.map(() => "?").join(", ")})
`);

const insertSecondary = archiveDb.prepare(`
  INSERT INTO ${SECONDARY} (${secondaryNames})
  VALUES (${secondaryCols.map(() => "?").join(", ")})
`);

const deleteSecondary = sourceDb.prepare(`
  DELETE FROM ${SECONDARY}
  WHERE ${JOIN_KEY} = ?
`);

const deletePrimary = sourceDb.prepare(`
  DELETE FROM ${PRIMARY}
  WHERE id = ?
`);

// ----------------------
// transaction globale
// ----------------------

const tx = sourceDb.transaction(() => {
  const primaries = selectPrimary.all();

  const archiveTx = archiveDb.transaction(() => {
    for (const row of primaries) {
      insertPrimary.run(Object.values(row));

      const secondaryRows = selectSecondary.all(row.id);

      for (const s of secondaryRows) {
        insertSecondary.run(Object.values(s));
      }
    }
  });

  archiveTx();

  if (DELETE_MODE) {
    for (const row of primaries) {
      deleteSecondary.run(row.id);
      deletePrimary.run(row.id);
    }
  }

  return primaries.length;
});

// ----------------------
// exécution
// ----------------------

const count = tx();

sourceDb.close();
archiveDb.close();

console.log(`Archivage terminé : ${count} entrées primaires`);
console.log(`Archive utilisée : ${archivePath}`);
