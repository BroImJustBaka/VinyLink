"""Agente de demostración (sin API key ni MongoDB):

    .venv\\Scripts\\python pruebas\\servidor_demo.py

Levanta el microservicio REAL en http://localhost:8000 conectado al backend
de la demo (back: npm run demo), pero con MongoDB en memoria y un "Claude"
simulado que siempre busca en el catálogo con el texto del cliente y responde
con lo que encontró. Sirve para probar la interfaz del chat y las reseñas;
para respuestas de verdad usa uvicorn con tu ANTHROPIC_API_KEY (ver README).
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _mensaje(contenido, stop):
    return {
        "id": "msg_demo", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
        "content": contenido, "stop_reason": stop, "stop_sequence": None,
        "usage": {"input_tokens": 0, "output_tokens": 0},
    }


def _responder(peticion):
    ultimo = peticion["messages"][-1]
    if isinstance(ultimo["content"], str):
        return _mensaje(
            [{"type": "tool_use", "id": "toolu_demo", "name": "buscar_productos",
              "input": {"texto": ultimo["content"][:80], "categoria_id": None}}],
            "tool_use",
        )
    resultado = next((b for b in ultimo["content"] if b.get("type") == "tool_result"), None)
    try:
        productos = json.loads(resultado["content"]).get("productos", []) if resultado else []
    except (TypeError, ValueError):
        productos = []
    if productos:
        lista = "\n".join(f"- **{p['nombre']}**: ${p['precio']:,.2f}" for p in productos[:4])
        texto = f"(Demo sin IA) Encontré esto en la tienda:\n{lista}\nPuedes agregarlos al carrito desde las tarjetas."
    else:
        texto = "(Demo sin IA) No encontré productos con esas palabras. Prueba con «audífonos», «vinilo» o «guitarra»."
    return _mensaje([{"type": "text", "text": texto}], "end_turn")


class _ClaudeSimulado(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        cuerpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        datos = json.dumps(_responder(cuerpo)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)


def main():
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), _ClaudeSimulado)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    os.environ.update(
        ANTHROPIC_API_KEY="demo",
        GEMINI_API_KEY="",  # la demo siempre usa el "Claude" simulado
        ANTHROPIC_BASE_URL=f"http://127.0.0.1:{servidor.server_address[1]}",
        BACKEND_GRAPHQL_URL=os.environ.get("BACKEND_GRAPHQL_URL", "http://localhost:4000/"),
        AGENTE_CLAVE_INTERNA=os.environ.get("AGENTE_CLAVE_INTERNA", ""),
    )

    import uvicorn

    import app.main
    from mongo_falso import ClienteMongoFalso

    app.main.conectar = lambda _uri: ClienteMongoFalso()
    print("Agente de demo en http://localhost:8000 (Claude y MongoDB simulados).")
    uvicorn.run(app.main.app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), log_level="warning")


if __name__ == "__main__":
    main()
