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
  estado     TEXT NOT NULL DEFAULT 'pendiente', -- ver la migración de pagos al final
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

-- ============================================================
-- Panel de administración y pagos con Stripe
-- Migración idempotente: cada sentencia solo agrega lo que falta, así
-- que se puede correr en cada arranque igual que el resto del archivo.
-- ============================================================

-- Usuario: fecha de alta (para "clientes nuevos" en el panel) y su
-- Customer de Stripe (SPEI lo necesita para darle una CLABE propia).
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Pedido: nace "pendiente" y pasa a "pagado" cuando Stripe confirma el cobro.
--   pendiente → pagado → enviado → entregado
--   pendiente → cancelado      (pago rechazado, vencido o cancelado)
--   pagado/enviado/entregado → reembolsado
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS metodo_pago TEXT;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS pagado_en TIMESTAMPTZ;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE pedido ALTER COLUMN estado SET DEFAULT 'pendiente';
-- Los pedidos de antes de los pagos en línea ("confirmado") cuentan como pagados.
UPDATE pedido SET estado = 'pagado', pagado_en = fecha WHERE estado = 'confirmado';
ALTER TABLE pedido DROP CONSTRAINT IF EXISTS pedido_estado_check;
ALTER TABLE pedido ADD CONSTRAINT pedido_estado_check
  CHECK (estado IN ('pendiente', 'pagado', 'enviado', 'entregado', 'cancelado', 'reembolsado'));
ALTER TABLE pedido DROP CONSTRAINT IF EXISTS pedido_metodo_pago_check;
ALTER TABLE pedido ADD CONSTRAINT pedido_metodo_pago_check
  CHECK (metodo_pago IS NULL OR metodo_pago IN ('credito', 'debito', 'oxxo', 'spei', 'link'));
CREATE INDEX IF NOT EXISTS pedido_usuario_idx ON pedido(usuario_id);
CREATE INDEX IF NOT EXISTS pedido_estado_idx ON pedido(estado);
CREATE INDEX IF NOT EXISTS detalle_pedido_pedido_idx ON detalle_pedido(pedido_id);

-- ------------------------------------------------------------
-- Pago (1) ── (1) Pedido — el cobro en Stripe de cada pedido.
-- `detalle` guarda lo que se le muestra al cliente según el método:
-- ficha OXXO, CLABE de SPEI, URL del link de pago o la tarjeta usada.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pago (
  id                         SERIAL PRIMARY KEY,
  pedido_id                  INTEGER NOT NULL UNIQUE REFERENCES pedido(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  metodo                     TEXT NOT NULL
    CHECK (metodo IN ('credito', 'debito', 'oxxo', 'spei', 'link')),
  estado                     TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'requiere_accion', 'pagado', 'fallido', 'cancelado', 'reembolsado')),
  monto_centavos             INTEGER NOT NULL CHECK (monto_centavos > 0),
  stripe_payment_intent_id   TEXT UNIQUE,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_reembolso_id        TEXT,
  detalle                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  error                      TEXT,
  creado_en                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pago_estado_idx ON pago(estado);

-- ============================================================
-- Back office completo
-- Igual que la sección anterior: cada sentencia solo agrega lo que falta,
-- así que corre en cada arranque sin borrar datos.
-- ============================================================

-- ------------------------------------------------------------
-- Usuarios: roles del personal, bloqueo de cuentas y teléfono.
--   CLIENTE   compra en la tienda
--   ADMIN     todo el panel
--   ALMACEN   catálogo, inventario, proveedores y envíos
--   SOPORTE   pedidos (cancelar, notas), clientes, correos y links de pago
--   FINANZAS  reportes, reembolsos, cupones y links de pago
-- (Los permisos de cada rol viven en back/src/modules/auth/permisos.js.)
-- ------------------------------------------------------------
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check
  CHECK (rol IN ('CLIENTE', 'ADMIN', 'ALMACEN', 'SOPORTE', 'FINANZAS'));
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS telefono TEXT;

-- Restablecer contraseña: token de un solo uso (se guarda su SHA-256) que vence en 1 hora.
CREATE TABLE IF NOT EXISTS restablecimiento (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_en  TIMESTAMPTZ NOT NULL,
  usado_en   TIMESTAMPTZ
);

-- Libreta de direcciones del cliente (Usuario 1 ── N Direccion).
CREATE TABLE IF NOT EXISTS direccion (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  nombre      TEXT NOT NULL,
  telefono    TEXT NOT NULL,
  calle       TEXT NOT NULL,
  colonia     TEXT NOT NULL,
  ciudad      TEXT NOT NULL,
  estado      TEXT NOT NULL,
  cp          TEXT NOT NULL CHECK (cp ~ '^[0-9]{5}$'),
  referencias TEXT,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS direccion_usuario_idx ON direccion(usuario_id);

-- ------------------------------------------------------------
-- Catálogo: productos activos/inactivos, SKU, stock mínimo e imágenes subidas.
-- Un producto inactivo no se ve en la tienda ni se puede comprar, pero
-- conserva su historial (es la alternativa a borrarlo si ya tiene pedidos).
-- ------------------------------------------------------------
ALTER TABLE producto ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE producto ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE producto ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 5
  CHECK (stock_minimo >= 0);
ALTER TABLE producto ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS producto_sku_idx ON producto(upper(sku)) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS producto_categoria_idx ON producto(categoria_id);

-- Imágenes subidas desde el panel. Se guardan en la base (BYTEA) para que
-- funcionen igual en local y en cualquier hosting, sin un disco ni un
-- servicio extra. Se sirven en GET /imagenes/:id.
CREATE TABLE IF NOT EXISTS imagen (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  bytes      INTEGER NOT NULL CHECK (bytes > 0),
  datos      BYTEA NOT NULL,
  usuario_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Inventario: proveedores y bitácora de movimientos (kárdex).
-- Cada cambio de stock deja un renglón: quién, cuándo, cuánto y por qué.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proveedor (
  id        SERIAL PRIMARY KEY,
  nombre    TEXT NOT NULL,
  contacto  TEXT,
  email     TEXT,
  telefono  TEXT,
  notas     TEXT,
  activo    BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_nombre_idx ON proveedor(lower(nombre));

--   inicial      stock con el que se dio de alta el producto
--   entrada      llegó mercancía (de un proveedor)
--   ajuste       corrección manual (conteo físico, merma, daño...)
--   venta        se apartó para un pedido
--   cancelacion  regresó porque el pedido se canceló
--   reembolso    regresó porque el pedido se reembolsó
CREATE TABLE IF NOT EXISTS movimiento_inventario (
  id               SERIAL PRIMARY KEY,
  producto_id      INTEGER NOT NULL REFERENCES producto(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  tipo             TEXT NOT NULL
    CHECK (tipo IN ('inicial', 'entrada', 'ajuste', 'venta', 'cancelacion', 'reembolso')),
  cantidad         INTEGER NOT NULL,          -- positiva entra, negativa sale
  stock_resultante INTEGER NOT NULL CHECK (stock_resultante >= 0),
  pedido_id        INTEGER REFERENCES pedido(id) ON DELETE SET NULL ON UPDATE CASCADE,
  proveedor_id     INTEGER REFERENCES proveedor(id) ON DELETE SET NULL ON UPDATE CASCADE,
  costo_unitario   DOUBLE PRECISION CHECK (costo_unitario IS NULL OR costo_unitario >= 0),
  usuario_id       INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  motivo           TEXT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS movimiento_producto_idx ON movimiento_inventario(producto_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS movimiento_fecha_idx ON movimiento_inventario(creado_en DESC);

-- Los productos que ya existían arrancan su kárdex con su stock actual.
INSERT INTO movimiento_inventario (producto_id, tipo, cantidad, stock_resultante, motivo)
SELECT p.id, 'inicial', p.stock, p.stock, 'Inventario inicial'
  FROM producto p
 WHERE NOT EXISTS (SELECT 1 FROM movimiento_inventario m WHERE m.producto_id = p.id);

-- ------------------------------------------------------------
-- Cupones de descuento.
--   porcentaje    valor = % de descuento sobre el subtotal (1 a 100)
--   monto         valor = pesos que se descuentan
--   envio_gratis  no descuenta productos; quita el costo de envío
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cupon (
  id               SERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL CHECK (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  descripcion      TEXT,
  tipo             TEXT NOT NULL CHECK (tipo IN ('porcentaje', 'monto', 'envio_gratis')),
  valor            DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (valor >= 0),
  minimo_compra    DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (minimo_compra >= 0),
  usos_maximos     INTEGER CHECK (usos_maximos IS NULL OR usos_maximos > 0),
  usos_por_cliente INTEGER CHECK (usos_por_cliente IS NULL OR usos_por_cliente > 0),
  vigente_desde    TIMESTAMPTZ,
  vigente_hasta    TIMESTAMPTZ,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS cupon_codigo_idx ON cupon(codigo);

INSERT INTO cupon (codigo, descripcion, tipo, valor, minimo_compra)
SELECT * FROM (VALUES
  ('BIENVENIDA10', '10% de descuento en tu compra', 'porcentaje', 10.0, 0.0),
  ('ENVIOGRATIS', 'Envío gratis sin mínimo de compra', 'envio_gratis', 0.0, 0.0)
) AS v(codigo, descripcion, tipo, valor, minimo_compra)
WHERE NOT EXISTS (SELECT 1 FROM cupon);

-- ------------------------------------------------------------
-- Pedido: desglose del total, cupón, dirección y datos del envío.
--   total = subtotal - descuento + costo_envio
-- `envio` guarda una COPIA de la dirección (si el cliente la edita o la
-- borra de su libreta después, el pedido conserva a dónde se mandó).
-- ------------------------------------------------------------
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS subtotal DOUBLE PRECISION;
UPDATE pedido SET subtotal = total WHERE subtotal IS NULL;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS descuento DOUBLE PRECISION NOT NULL DEFAULT 0
  CHECK (descuento >= 0);
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS costo_envio DOUBLE PRECISION NOT NULL DEFAULT 0
  CHECK (costo_envio >= 0);
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS cupon_id INTEGER REFERENCES cupon(id)
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS envio JSONB;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS paqueteria TEXT;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS numero_guia TEXT;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS enviado_en TIMESTAMPTZ;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMPTZ;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS monto_reembolsado DOUBLE PRECISION NOT NULL DEFAULT 0
  CHECK (monto_reembolsado >= 0);
CREATE INDEX IF NOT EXISTS pedido_cupon_idx ON pedido(cupon_id) WHERE cupon_id IS NOT NULL;

-- Línea de tiempo del pedido: cada cambio de estado (quién y cuándo)...
CREATE TABLE IF NOT EXISTS historial_pedido (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedido(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  usuario_id      INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  comentario      TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS historial_pedido_idx ON historial_pedido(pedido_id, creado_en);

-- ...y las notas internas que escribe el personal (el cliente no las ve).
CREATE TABLE IF NOT EXISTS nota_pedido (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedido(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  usuario_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  texto      TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 2000),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nota_pedido_idx ON nota_pedido(pedido_id, creado_en);

-- Reembolsos (totales o parciales) hechos desde el panel.
CREATE TABLE IF NOT EXISTS reembolso (
  id                  SERIAL PRIMARY KEY,
  pedido_id           INTEGER NOT NULL REFERENCES pedido(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  monto_centavos      INTEGER NOT NULL CHECK (monto_centavos > 0),
  parcial             BOOLEAN NOT NULL,
  repuso_stock        BOOLEAN NOT NULL DEFAULT FALSE,
  motivo              TEXT,
  stripe_reembolso_id TEXT,
  usuario_id          INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reembolso_pedido_idx ON reembolso(pedido_id);

-- ------------------------------------------------------------
-- Bitácora de auditoría: qué hizo cada persona del personal en el panel.
-- `usuario_nombre` se copia para que el registro siga legible aunque la
-- cuenta se borre después.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitacora (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  usuario_nombre TEXT,
  accion         TEXT NOT NULL,
  entidad        TEXT NOT NULL,
  entidad_id     TEXT,
  detalle        JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bitacora_fecha_idx ON bitacora(creado_en DESC);
CREATE INDEX IF NOT EXISTS bitacora_entidad_idx ON bitacora(entidad, entidad_id);

-- ------------------------------------------------------------
-- Correos que manda la tienda (bandeja de salida). Se guardan todos: si no
-- hay servidor SMTP configurado quedan como "simulado" y se pueden leer
-- desde el panel, así se prueban sin mandar correos reales.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correo (
  id         SERIAL PRIMARY KEY,
  para       TEXT NOT NULL,
  asunto     TEXT NOT NULL,
  html       TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  pedido_id  INTEGER REFERENCES pedido(id) ON DELETE SET NULL ON UPDATE CASCADE,
  usuario_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL ON UPDATE CASCADE,
  estado     TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'enviado', 'simulado', 'error')),
  error      TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviado_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS correo_fecha_idx ON correo(creado_en DESC);

-- ------------------------------------------------------------
-- Configuración de la tienda (clave → valor JSON), editable desde el panel.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
  clave          TEXT PRIMARY KEY,
  valor          JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO configuracion (clave, valor) VALUES
  ('nombre_tienda', '"VinyLink"'),
  ('email_contacto', '"contacto@vinylink.mx"'),
  ('costo_envio', '149'),
  ('envio_gratis_desde', '999'),
  ('iva_porcentaje', '16'),
  ('paqueterias', '["Estafeta", "DHL", "FedEx", "Correos de México"]')
ON CONFLICT (clave) DO NOTHING;
