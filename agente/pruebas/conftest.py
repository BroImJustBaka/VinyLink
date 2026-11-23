"""Preparación de las pruebas.

- MongoDB en memoria (mongomock con la API asíncrona de PyMongo).
- Un servidor HTTP que imita la API de Claude (/v1/messages) y el backend
  GraphQL de la tienda (/graphql). Las respuestas de Claude se programan en
  cada prueba con `simulado.claude(...)`.
"""

import json
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

PRODUCTOS = [
    {"id": "1", "nombre": "Audífonos Bluetooth", "descripcion": "Inalámbricos", "precio": 899.99, "stock": 25, "imagen": "https://x/1.jpg", "activo": True, "categoria": {"id": "1", "nombre": "Audífonos"}},
    {"id": "2", "nombre": "Audífonos de estudio", "descripcion": "Over-ear", "precio": 1499.0, "stock": 0, "imagen": "https://x/2.jpg", "activo": True, "categoria": {"id": "1", "nombre": "Audífonos"}},
    {"id": "3", "nombre": "Earbuds inalámbricos", "descripcion": "Estuche", "precio": 699.5, "stock": 40, "imagen": "https://x/3.jpg", "activo": True, "categoria": {"id": "1", "nombre": "Audífonos"}},
]
USUARIOS = {
    "tok-ana": {"id": "10", "nombre": "Ana María López", "email": "ana@test.com", "rol": "CLIENTE"},
    "tok-beto": {"id": "11", "nombre": "Beto", "email": "beto@test.com", "rol": "CLIENTE"},
}
PEDIDOS_ANA = [
    {"id": "7", "fecha": "2026-11-20T10:00:00Z", "estado": "enviado", "total": 899.99, "metodoPago": "paypal", "numeroGuia": "DHL123", "paqueteria": "DHL",
     "detalles": [{"cantidad": 1, "precioUnitario": 899.99, "producto": {"id": "1", "nombre": "Audífonos Bluetooth"}}]},
]


class Simulado:
    def __init__(self):
        self.respuestas_claude = []
        self.peticiones_claude = []
        self.respuestas_gemini = []
        self.peticiones_gemini = []
        self.status_gemini = 200
        self.demora_gemini = 0.0
        self.modelos_caidos = set()
        self.modelos_validos = None  # None = cualquier modelo existe
        self.peticiones_tienda = []
        self.status_claude = 200
        self.error_claude = None

    def claude(self, *respuestas):
        self.respuestas_claude.extend(respuestas)

    def gemini(self, *respuestas):
        self.respuestas_gemini.extend(respuestas)

    def reiniciar(self):
        self.__init__()


simulado = Simulado()


def mensaje(contenido, stop="end_turn"):
    """Respuesta de la API de Messages con la forma real."""
    return {
        "id": "msg_prueba", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
        "content": contenido, "stop_reason": stop, "stop_sequence": None,
        "usage": {"input_tokens": 100, "output_tokens": 20},
    }


def texto(t):
    return mensaje([{"type": "text", "text": t}])


def herramienta(nombre, entrada, id_="toolu_1", pensamiento=True):
    bloques = [{"type": "thinking", "thinking": "", "signature": "firma-123"}] if pensamiento else []
    bloques.append({"type": "tool_use", "id": id_, "name": nombre, "input": entrada})
    return mensaje(bloques, stop="tool_use")


def gemini_llamada(nombre, args, id_="fc_1", firma="c2lnbmF0dXJh"):
    """Respuesta de generateContent que pide una herramienta (con firma de pensamiento)."""
    return {"candidates": [{"content": {"role": "model", "parts": [
        {"functionCall": {"id": id_, "name": nombre, "args": args}, "thoughtSignature": firma}]}, "finishReason": "STOP"}]}


def gemini_texto(t, razon="STOP"):
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": t}]}, "finishReason": razon}]}


def responder_tienda(cuerpo, token):
    q, v = cuerpo["query"], cuerpo.get("variables") or {}
    usuario = USUARIOS.get(token)
    if "me {" in q:
        return {"data": {"me": usuario}}
    if "buscar(" in q:
        hallados = [p for p in PRODUCTOS if v["t"].lower()[:5] in p["nombre"].lower()]
        return {"data": {"buscar": {"total": len(hallados), "aproximada": False, "productos": hallados}}}
    if "producto(" in q:
        return {"data": {"producto": next((p for p in PRODUCTOS if p["id"] == v["id"]), None)}}
    if "categorias" in q:
        return {"data": {"categorias": [{"id": "1", "nombre": "Audífonos", "descripcion": "..."}]}}
    if "misPedidos" in q:
        if not usuario:
            return {"errors": [{"message": "Necesitas iniciar sesión"}]}
        return {"data": {"misPedidos": PEDIDOS_ANA if token == "tok-ana" else []}}
    if "pedido(" in q:
        if not usuario:
            return {"errors": [{"message": "Necesitas iniciar sesión"}]}
        p = next((x for x in PEDIDOS_ANA if x["id"] == v["id"]), None) if token == "tok-ana" else None
        return {"data": {"pedido": p}} if p else {"errors": [{"message": f"No existe el pedido #{v['id']}"}]}
    if "tipoCambio" in q:
        return {"data": {"tipoCambio": {"valor": 18.35, "fecha": "2026-11-21", "fuente": "Banco de México (FIX)"}}}
    return {"errors": [{"message": "consulta desconocida"}]}


class Manejador(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if "/models" in self.path:  # ListModels de Gemini
            nombres = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-image", "gemini-2.5-pro", "text-embedding-004"]
            modelos = [{"name": f"models/{n}", "supportedGenerationMethods": ["embedContent"] if "embedding" in n else ["generateContent"]} for n in nombres]
            return self._json(200, {"models": modelos})
        self._json(404, {})

    def _json(self, status, cuerpo):
        datos = json.dumps(cuerpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_POST(self):
        cuerpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.startswith("/v1/messages"):
            simulado.peticiones_claude.append(cuerpo)
            if simulado.status_claude != 200:
                return self._json(simulado.status_claude, simulado.error_claude or {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
            if not simulado.respuestas_claude:
                return self._json(500, {"type": "error", "error": {"type": "api_error", "message": "sin respuesta programada"}})
            return self._json(200, simulado.respuestas_claude.pop(0))
        if ":generateContent" in self.path:
            simulado.peticiones_gemini.append({"ruta": self.path, "llave": self.headers.get("x-goog-api-key"), **cuerpo})
            modelo = self.path.split("/models/")[1].split(":")[0]
            if simulado.modelos_validos is not None and modelo not in simulado.modelos_validos:
                return self._json(404, {"error": {"code": 404, "message": f"models/{modelo} is not found", "status": "NOT_FOUND"}})
            time.sleep(simulado.demora_gemini)
            if self.path.split("/models/")[1].split(":")[0] in simulado.modelos_caidos:
                return self._json(503, {"error": {"code": 503, "message": "This model is currently experiencing high demand.", "status": "UNAVAILABLE"}})
            if simulado.status_gemini != 200:
                return self._json(simulado.status_gemini, {"error": {"code": simulado.status_gemini, "message": "API key not valid. Please pass a valid API key." if simulado.status_gemini < 429 else "Resource has been exhausted (e.g. check quota).", "status": "INVALID_ARGUMENT" if simulado.status_gemini < 429 else "RESOURCE_EXHAUSTED"}})
            if not simulado.respuestas_gemini:
                return self._json(500, {"error": {"code": 500, "message": "sin respuesta programada", "status": "INTERNAL"}})
            return self._json(200, simulado.respuestas_gemini.pop(0))
        if self.path == "/graphql":
            token = (self.headers.get("Authorization") or "").removeprefix("Bearer ") or None
            simulado.peticiones_tienda.append({"token": token, "query": cuerpo["query"]})
            return self._json(200, responder_tienda(cuerpo, token))
        self._json(404, {})


@pytest.fixture(scope="session")
def servidor_simulado():
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    yield f"http://127.0.0.1:{servidor.server_address[1]}"
    servidor.shutdown()


@pytest.fixture
def cliente_gemini(servidor_simulado, monkeypatch):
    """Igual que `cliente`, pero con Gemini como proveedor de IA."""
    monkeypatch.setenv("GEMINI_API_KEY", "llave-gemini-prueba")
    monkeypatch.setenv("GOOGLE_GEMINI_BASE_URL", servidor_simulado)
    yield from _cliente(servidor_simulado, monkeypatch)


@pytest.fixture
def cliente(servidor_simulado, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    yield from _cliente(servidor_simulado, monkeypatch)


def _cliente(servidor_simulado, monkeypatch):
    """TestClient con el ciclo de vida completo (Mongo, Claude y tienda simulados)."""
    from fastapi.testclient import TestClient

    from app.config import config

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-prueba")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", servidor_simulado)
    monkeypatch.setenv("BACKEND_GRAPHQL_URL", f"{servidor_simulado}/graphql")
    monkeypatch.setenv("MONGODB_URI", "mongodb://memoria")
    monkeypatch.setenv("AGENTE_CLAVE_INTERNA", "clave-prueba")
    config.cache_clear()
    simulado.reiniciar()

    import app.main
    from mongo_falso import ClienteMongoFalso

    monkeypatch.setattr(app.main, "conectar", lambda _uri: ClienteMongoFalso())
    app = app.main.app

    with TestClient(app, headers={"X-Clave-Interna": "clave-prueba"}) as c:
        yield c
    config.cache_clear()
