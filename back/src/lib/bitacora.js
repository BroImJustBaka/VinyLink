// Bitácora de auditoría: deja constancia de lo que hace el personal en el
// panel (quién, qué, sobre qué y con qué datos) y lo avisa en tiempo real a
// los demás administradores.
import { pool } from "../db.js";
import { alConfirmar } from "./sql.js";
import { publicarEventoAdmin } from "./pubsub.js";

// registrar(context.user, "producto.actualizar", "producto", 7, { precio: [599, 549] }, client)
// `client` es opcional: si se pasa, el registro forma parte de la misma
// transacción (si la operación se deshace, el registro también).
export async function registrar(usuario, accion, entidad, entidadId, detalle = {}, client = pool) {
  await client.query(
    `INSERT INTO bitacora (usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      usuario?.id ?? null,
      usuario?.nombre ?? "Sistema",
      accion,
      entidad,
      entidadId == null ? null : String(entidadId),
      JSON.stringify(detalle ?? {}),
    ]
  );
  alConfirmar(client, () =>
    publicarEventoAdmin({
      tipo: "accion",
      mensaje: `${usuario?.nombre ?? "Sistema"}: ${describir(accion, entidad, entidadId)}`,
      pedidoId: entidad === "pedido" ? entidadId : null,
      productoId: entidad === "producto" ? entidadId : null,
      usuarioId: usuario?.id ?? null,
    })
  );
}

const VERBOS = {
  crear: "creó",
  actualizar: "editó",
  eliminar: "eliminó",
  activar: "activó",
  desactivar: "desactivó",
  enviar: "marcó como enviado",
  entregar: "marcó como entregado",
  cancelar: "canceló",
  reembolsar: "reembolsó",
  reembolso_parcial: "reembolsó parte de",
  nota: "agregó una nota a",
  rol: "cambió el rol de",
  bloquear: "bloqueó",
  desbloquear: "desbloqueó",
  entrada: "registró una entrada de",
  ajuste: "ajustó el stock de",
  link: "creó un link de pago,",
  subir: "subió",
  restablecer: "mandó un link para restablecer la contraseña de",
  reenviar: "reenvió",
};

// "producto.actualizar" → "editó producto #7"
export function describir(accion, entidad, entidadId) {
  const verbo = VERBOS[accion.split(".").pop()] ?? accion;
  return `${verbo} ${entidad}${entidadId == null ? "" : ` #${entidadId}`}`;
}
