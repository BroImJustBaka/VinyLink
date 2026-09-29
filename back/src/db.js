import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Falta la variable de entorno DATABASE_URL (cadena de conexión de Neon/PostgreSQL). Define un archivo .env en back/ — ver .env.example."
  );
}

// Pool de conexiones a PostgreSQL (Neon). Neon requiere SSL.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL_SCRIPT_PATH = path.join(__dirname, "..", "..", "db.sql");

// Aplica el script db.sql (crea tablas si no existen y siembra datos de
// ejemplo si las tablas están vacías). Es idempotente: se puede llamar en
// cada arranque sin duplicar datos.
export async function initDb() {
  const script = fs.readFileSync(SQL_SCRIPT_PATH, "utf-8");
  await pool.query(script);
  console.log("Base de datos PostgreSQL lista (esquema + seed verificados).");
}
