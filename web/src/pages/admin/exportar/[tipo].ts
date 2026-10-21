// Descarga de reportes CSV: /admin/exportar/pedidos.csv?desde=2026-10-01&hasta=2026-10-31
// El backend arma el CSV (adminExportar) y revisa el permiso; aquí solo se
// entrega como archivo. El middleware ya dejó pasar solo al personal.
import type { APIRoute } from "astro";
import { graphqlServer } from "../../../lib/graphql";
import { QUERY_EXPORTAR } from "../../../lib/queries/admin.js";

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const tipo = (params.tipo ?? "").replace(/\.csv$/, "");
  const desde = url.searchParams.get("desde") || null;
  const hasta = url.searchParams.get("hasta") || null;
  try {
    const { adminExportar } = await graphqlServer(cookies, QUERY_EXPORTAR, { tipo, desde, hasta });
    const hoy = new Date().toISOString().slice(0, 10);
    return new Response(adminExportar, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vinylink-${tipo}-${hoy}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    return new Response(`No se pudo generar el reporte: ${mensaje}`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};
