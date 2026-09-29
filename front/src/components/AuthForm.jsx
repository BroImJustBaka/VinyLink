import { useState } from "react";
import { graphqlRequest } from "../api/client.js";
import { MUTATION_LOGIN, MUTATION_REGISTRAR } from "../api/queries.js";
import { useAuthStore } from "../store/useAuthStore.js";
import { useCartStore } from "../store/useCartStore.js";

// Mismo patrón que CheckoutView: form controlado + graphqlRequest directo +
// estados cargando/error locales. onAuthExitosa la llama App.jsx para
// mandar a la vista de perfil una vez iniciada la sesión.
export function AuthForm({ onAuthExitosa }) {
  const [modo, setModo] = useState("login"); // "login" | "registro"
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const iniciarSesion = useAuthStore((s) => s.iniciarSesion);
  const cargarCarritoDesdeDB = useCartStore((s) => s.cargarDesdeDB);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    try {
      let usuario;
      if (modo === "login") {
        const res = await graphqlRequest(MUTATION_LOGIN, { email, password });
        usuario = res.login;
      } else {
        const res = await graphqlRequest(MUTATION_REGISTRAR, { nombre, email, password });
        usuario = res.registrar;
      }

      iniciarSesion(usuario); // se persiste solo en localStorage
      await cargarCarritoDesdeDB(); // trae lo que ya tuviera guardado en la DB
      onAuthExitosa?.(usuario);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="auth-form">
      <div className="auth-form__tabs">
        <button
          type="button"
          className={`btn ${modo === "login" ? "btn--primario" : "btn--link"}`}
          onClick={() => setModo("login")}
          disabled={modo === "login"}
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          className={`btn ${modo === "registro" ? "btn--primario" : "btn--link"}`}
          onClick={() => setModo("registro")}
          disabled={modo === "registro"}
        >
          Crear cuenta
        </button>
      </div>

      <form onSubmit={handleSubmit} className="checkout-form">
        {modo === "registro" && (
          <label>
            Nombre
            <input
              type="text"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <div className="error-box">
            <p>{error}</p>
          </div>
        )}

        <button className="btn btn--primario" type="submit" disabled={enviando}>
          {enviando ? "Enviando..." : modo === "login" ? "Entrar" : "Registrarme"}
        </button>
      </form>
    </section>
  );
}
