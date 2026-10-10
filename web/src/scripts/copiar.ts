// Botones "Copiar": cualquier elemento con data-copiar="texto" copia ese
// texto al portapapeles al hacer clic y muestra "¡Copiado!" un momento.
document.addEventListener("click", async (evento) => {
  const boton = (evento.target as HTMLElement).closest<HTMLElement>("[data-copiar]");
  if (!boton) return;
  const original = boton.textContent;
  try {
    await navigator.clipboard.writeText(boton.dataset.copiar ?? "");
    boton.textContent = "¡Copiado!";
  } catch {
    boton.textContent = "No se pudo copiar";
  }
  setTimeout(() => (boton.textContent = original), 1500);
});
