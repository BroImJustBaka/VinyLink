import { useState, useEffect, useTransition } from "react";
import { TopBar } from "./components/TopBar.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Footer } from "./components/Footer.jsx";
import { ProductModal } from "./components/ProductModal.jsx";
import { HomeView } from "./views/HomeView.jsx";
import { CategoryView } from "./views/CategoryView.jsx";
import { CartView } from "./views/CartView.jsx";
import { CheckoutView } from "./views/CheckoutView.jsx";
import { PerfilView } from "./views/PerfilView.jsx";
import { AuthForm } from "./components/AuthForm.jsx";
import { useGraphQL } from "./hooks/useGraphQL.js";
import { graphqlRequest } from "./api/client.js";
import { QUERY_CATEGORIAS, QUERY_CATEGORIA } from "./api/queries.js";
import { useCartStore } from "./store/useCartStore.js";
import { useAuthStore } from "./store/useAuthStore.js";
import "./App.css";

// La app entera es una máquina de estados: `vista` dice qué template se
// muestra (no hay react-router ni URLs). Los eventos del usuario (elegir
// categoría, ver producto, agregar al carrito, finalizar compra, volver)
// son los que mueven `vista` de un valor a otro — ver reporte-p2.md para
// el diagrama de estados completo.
const VISTAS = {
  HOME: "home",
  CATEGORIA: "categoria",
  CARRITO: "carrito",
  CHECKOUT: "checkout",
  PERFIL: "perfil",
  AUTH: "auth",
};

export default function App() {
  const [vista, setVista] = useState(VISTAS.HOME);
  const [categoriaId, setCategoriaId] = useState(null);
  const [categoriaDetalle, setCategoriaDetalle] = useState(null);
  const [cargandoCategoria, setCargandoCategoria] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState(null);
  const [productoDetalle, setProductoDetalle] = useState(null); // modal
  const [busqueda, setBusqueda] = useState("");
  const [pedidoConfirmado, setPedidoConfirmado] = useState(null);
  const [, startTransition] = useTransition(); // tema 13: cambiar de vista sin bloquear la UI

  const agregarProducto = useCartStore((s) => s.agregarProducto);
  const vaciarCarrito = useCartStore((s) => s.vaciarCarrito);
  const cargarCarritoDesdeDB = useCartStore((s) => s.cargarDesdeDB);
  const usuario = useAuthStore((s) => s.usuario);

  // Si ya había sesión persistida (localStorage), trae el carrito guardado
  // en la DB apenas arranca la app.
  useEffect(() => {
    cargarCarritoDesdeDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    data: dataCategorias,
    cargando: cargandoCategorias,
    error: errorCategorias,
    recargar: recargarCategorias,
  } = useGraphQL(QUERY_CATEGORIAS);

  // Evento: elegirCategoria → pide el detalle (con productos) al backend
  // y avanza la máquina a la vista "categoria".
  async function irACategoria(id) {
    startTransition(() => setVista(VISTAS.CATEGORIA));
    setCategoriaId(id);
    setCargandoCategoria(true);
    setErrorCategoria(null);
    try {
      const data = await graphqlRequest(QUERY_CATEGORIA, { id });
      setCategoriaDetalle(data.categoria);
    } catch (err) {
      setErrorCategoria(err.message);
    } finally {
      setCargandoCategoria(false);
    }
  }

  function irAHome() {
    startTransition(() => setVista(VISTAS.HOME));
  }
  function irACarrito() {
    startTransition(() => setVista(VISTAS.CARRITO));
  }
  function irACheckout() {
    startTransition(() => setVista(VISTAS.CHECKOUT));
  }
  // Si ya hay sesión va directo al perfil; si no, al login/registro.
  function irAPerfilOAuth() {
    startTransition(() => setVista(usuario ? VISTAS.PERFIL : VISTAS.AUTH));
  }

  function manejarPedidoCreado(pedido) {
    setPedidoConfirmado(pedido);
    vaciarCarrito();
    startTransition(() => setVista(VISTAS.HOME));
  }

  return (
    <div className="app">
      <TopBar
        busqueda={busqueda}
        onBuscar={setBusqueda}
        onIrHome={irAHome}
        onIrCarrito={irACarrito}
        onIrPerfil={irAPerfilOAuth}
      />

      <div className="app__body">
        <Sidebar
          categorias={dataCategorias?.categorias ?? []}
          categoriaActualId={categoriaId}
          onSeleccionarCategoria={irACategoria}
        />

        <main className="app__main">
          {pedidoConfirmado && vista === VISTAS.HOME && (
            <div className="confirmacion-box">
              ✅ ¡Pedido #{pedidoConfirmado.id} confirmado! Total: $
              {pedidoConfirmado.total.toFixed(2)}
              <button className="btn btn--link" onClick={() => setPedidoConfirmado(null)}>
                Cerrar
              </button>
            </div>
          )}

          {vista === VISTAS.HOME && (
            <HomeView
              categorias={dataCategorias?.categorias ?? []}
              cargando={cargandoCategorias}
              error={errorCategorias}
              onReintentar={recargarCategorias}
              onSeleccionarCategoria={irACategoria}
            />
          )}

          {vista === VISTAS.CATEGORIA && (
            <CategoryView
              categoria={categoriaDetalle}
              cargando={cargandoCategoria}
              error={errorCategoria}
              busqueda={busqueda}
              onReintentar={() => irACategoria(categoriaId)}
              onVerDetalle={setProductoDetalle}
              onVolver={irAHome}
            />
          )}

          {vista === VISTAS.CARRITO && (
            <CartView onSeguirComprando={irAHome} onIrCheckout={irACheckout} />
          )}

          {vista === VISTAS.CHECKOUT && (
            <CheckoutView onVolver={irACarrito} onPedidoCreado={manejarPedidoCreado} />
          )}

          {vista === VISTAS.PERFIL && (
            <PerfilView onIrCarrito={irACarrito} onIrHome={irAHome} />
          )}

          {vista === VISTAS.AUTH && (
            <AuthForm onAuthExitosa={() => startTransition(() => setVista(VISTAS.PERFIL))} />
          )}
        </main>
      </div>

      <Footer />

      <ProductModal
        producto={productoDetalle}
        onCerrar={() => setProductoDetalle(null)}
        onAgregar={agregarProducto}
      />
    </div>
  );
}
