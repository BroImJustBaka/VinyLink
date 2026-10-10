// Tooltip de las gráficas del panel admin. Aparece al pasar el mouse o al
// llegar con el teclado (Tab) a cualquier elemento con data-tip-valor.
// Los textos se ponen con textContent (nunca innerHTML): los nombres de los
// productos los escribe un usuario y no deben interpretarse como HTML.
const tip = document.createElement("div");
tip.className = "grafica-tooltip";
tip.setAttribute("role", "tooltip");
tip.hidden = true;
document.body.append(tip);

function mostrar(el: HTMLElement, x: number, y: number) {
  const valor = document.createElement("strong");
  valor.textContent = el.dataset.tipValor ?? "";
  const titulo = document.createElement("span");
  titulo.textContent = el.dataset.tipTitulo ?? "";
  tip.replaceChildren(valor, titulo);
  if (el.dataset.tipDetalle) {
    const detalle = document.createElement("span");
    detalle.textContent = el.dataset.tipDetalle;
    tip.append(detalle);
  }
  tip.hidden = false;

  // Arriba del puntero, sin salirse de la ventana.
  const { width, height } = tip.getBoundingClientRect();
  const izquierda = Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8);
  const arriba = y - height - 12 < 8 ? y + 16 : y - height - 12;
  tip.style.left = `${izquierda}px`;
  tip.style.top = `${arriba}px`;
}

const objetivo = (e: Event) =>
  (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip-valor]") ?? null;

document.addEventListener("pointermove", (e) => {
  const el = objetivo(e);
  if (el) mostrar(el, e.clientX, e.clientY);
  else tip.hidden = true;
});
document.addEventListener("focusin", (e) => {
  const el = objetivo(e);
  if (!el) return;
  const r = el.getBoundingClientRect();
  mostrar(el, r.left + r.width / 2, r.top);
});
document.addEventListener("focusout", () => (tip.hidden = true));
window.addEventListener("scroll", () => (tip.hidden = true), { passive: true });
