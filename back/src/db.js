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

// Una base en tu propia computadora (localhost) normalmente no tiene SSL.
const esLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL);

// Pool de conexiones a PostgreSQL (Neon). Neon requiere SSL.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: esLocal ? false : { rejectUnauthorized: false },
});

// Neon cierra las conexiones que pasan un rato sin usarse. Sin este manejador
// ese aviso tumbaría todo el servidor; así solo se registra y el pool abre
// una conexión nueva la próxima vez que se necesite.
pool.on("error", (err) => {
  console.error("Se cerró una conexión inactiva con PostgreSQL:", err.message);
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
