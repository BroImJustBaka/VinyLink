-- ============================================================
-- db.sql — Base de datos del e-commerce (Práctica P2-6)
-- Dialecto: PostgreSQL (motor usado por back/src/db.js vía pg + Neon).
-- ============================================================

-- ------------------------------------------------------------
-- Categoria (1) ── (N) Producto
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categoria (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  imagen      TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Producto (N) ── (1) Categoria
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS producto (
  id           SERIAL PRIMARY KEY,
  nombre       TEXT NOT NULL,
  descripcion  TEXT NOT NULL,
  precio       DOUBLE PRECISION NOT NULL CHECK (precio >= 0),
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  imagen       TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categoria(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- Usuario (1) ── (N) Pedido
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario (
  id       SERIAL PRIMARY KEY,
  nombre   TEXT NOT NULL,
  email    TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  rol      TEXT NOT NULL DEFAULT 'CLIENTE' CHECK (rol IN ('CLIENTE', 'ADMIN'))
);

-- ------------------------------------------------------------
-- Sesion (N) ── (1) Usuario — sesiones de login.
-- Se guarda el SHA-256 del token (nunca el token en claro).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesion (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_en  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sesion_usuario_idx ON sesion(usuario_id);

-- ------------------------------------------------------------
-- Pedido (N) ── (1) Usuario
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedido (
  id         SERIAL PRIMARY KEY,
  fecha      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado     TEXT NOT NULL DEFAULT 'confirmado',
  total      DOUBLE PRECISION NOT NULL CHECK (total >= 0),
  usuario_id INTEGER NOT NULL REFERENCES usuario(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- DetallePedido: renglones del pedido (Pedido N ── N Producto)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detalle_pedido (
  id               SERIAL PRIMARY KEY,
  pedido_id        INTEGER NOT NULL REFERENCES pedido(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  producto_id      INTEGER NOT NULL REFERENCES producto(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario  DOUBLE PRECISION NOT NULL CHECK (precio_unitario >= 0)
);

-- ------------------------------------------------------------
-- Carrito (1) ── (1) Usuario — un carrito activo por usuario
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carrito (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuario(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- DetalleCarrito: renglones del carrito (Carrito N ── N Producto)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detalle_carrito (
  id          SERIAL PRIMARY KEY,
  carrito_id  INTEGER NOT NULL REFERENCES carrito(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES producto(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
  UNIQUE (carrito_id, producto_id) -- un producto solo aparece una vez por carrito
);

-- ============================================================
-- Datos de ejemplo (seed) — solo se insertan si la tabla está vacía
-- ============================================================

INSERT INTO categoria (nombre, descripcion, imagen)
SELECT * FROM (VALUES
  ('Audífonos', 'Audífonos y auriculares para todo tipo de escucha', 'https://tse1.mm.bing.net/th/id/OIP.A0nc0qbBU4ToHXolb0z1ZAHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3'),
  ('Instrumentos', 'Instrumentos musicales para todos los niveles', 'https://down-th.img.susercontent.com/file/sg-11134201-7rdwx-lyeu78ezaww771'),
  ('Discos', 'Vinilos y discos de edición física', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/The_Beatles_Abbey_Road_album_cover.jpg/1280px-The_Beatles_Abbey_Road_album_cover.jpg')
) AS v(nombre, descripcion, imagen)
WHERE NOT EXISTS (SELECT 1 FROM categoria);

INSERT INTO producto (nombre, descripcion, precio, stock, imagen, categoria_id)
SELECT * FROM (VALUES
  ('Audífonos Bluetooth', 'Inalámbricos, cancelación de ruido', 899.99, 25, 'https://tse1.mm.bing.net/th/id/OIP.A0nc0qbBU4ToHXolb0z1ZAHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3', 1),
  ('Audífonos de estudio', 'Over-ear, respuesta plana para mezcla', 1499.00, 15, 'https://tse1.mm.bing.net/th/id/OIP.dCWNRPnWPU0WPdix1li3bgHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3', 1),
  ('Earbuds inalámbricos', 'Estuche de carga, resistentes al sudor', 699.50, 40, 'https://d2cdo4blch85n8.cloudfront.net/wp-content/uploads/2025/12/Huawei-FreeBuds-Pro-5-TWS-Earbuds.jpg', 1),
  ('Guitarra acústica', 'Cuerdas de acero, cuerpo de caoba', 2499.00, 12, 'https://th.bing.com/th/id/R.19688f293fe4c8b06fd0ef69e7544a2e?rik=1m9ypfPcZ05nYQ&pid=ImgRaw&r=0', 2),
  ('Teclado digital 61 teclas', '5 octavas, con altavoces integrados', 3299.00, 8, 'https://down-th.img.susercontent.com/file/sg-11134201-7rdwx-lyeu78ezaww771', 2),
  ('Batería electrónica', '8 pads, con módulo de sonidos', 6999.00, 5, 'https://tse3.mm.bing.net/th/id/OIP.Ibcbl-9NWkUsCqOKwab37QHaHp?r=0&w=568&h=587&rs=1&pid=ImgDetMain&o=7&rm=3', 2),
  ('Vinilo "Abbey Road"', 'Edición remasterizada 180g', 599.00, 20, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/The_Beatles_Abbey_Road_album_cover.jpg/1280px-The_Beatles_Abbey_Road_album_cover.jpg', 3),
  ('Vinilo "Thriller"', 'Reedición de aniversario', 549.00, 18, 'https://vanguardia.com.mx/binrepository/1383x649/231c0/1152d648/down-right/11604/BTGD/81339syfoil-ac-sl1500_1-3934740_20221122194336.jpg', 3)
) AS v(nombre, descripcion, precio, stock, imagen, categoria_id)
WHERE NOT EXISTS (SELECT 1 FROM producto);

INSERT INTO usuario (nombre, email, password, rol)
SELECT * FROM (VALUES
  -- Contraseñas hasheadas con bcrypt (10 rondas). Siguen siendo invitado123 / admin123.
  ('Cliente Invitado', 'invitado@tienda.com', '$2b$10$.3dS/aRe/XEuWrfv6ATer.MGx5sRfsdjLkUmKhHSJp2HD0jqjvDNi', 'CLIENTE'),
  ('Admin Tienda', 'admin@tienda.com', '$2b$10$YVA5OCH3SINArNsgdaxOrOXDs6qut7ZcbRxJRilR1tiZfyBLAI03G', 'ADMIN')
) AS v(nombre, email, password, rol)
WHERE NOT EXISTS (SELECT 1 FROM usuario);

-- Migración para bases que ya tenían los usuarios semilla en texto plano.
-- Solo toca la fila si la contraseña sigue siendo exactamente la de texto
-- plano, así que es idempotente y no pisa cuentas reales ni hashes.
UPDATE usuario
   SET password = '$2b$10$.3dS/aRe/XEuWrfv6ATer.MGx5sRfsdjLkUmKhHSJp2HD0jqjvDNi'
 WHERE email = 'invitado@tienda.com' AND password = 'invitado123';
UPDATE usuario
   SET password = '$2b$10$YVA5OCH3SINArNsgdaxOrOXDs6qut7ZcbRxJRilR1tiZfyBLAI03G'
 WHERE email = 'admin@tienda.com' AND password = 'admin123';
