"""Pruebas del asistente con Gemini (Google AI Studio) como proveedor."""

from conftest import gemini_llamada, gemini_texto, simulado

ANA = {"Authorization": "Bearer tok-ana"}


def test_salud_reporta_gemini(cliente_gemini):
    datos = cliente_gemini.get("/salud").json()
    assert datos["ia"] == "gemini" and datos["modo"] == "ia" and datos["modelo"] == "gemini-flash-latest"


def test_gemini_busca_productos_y_regresa_tarjetas(cliente_gemini):
    simulado.gemini(
        gemini_llamada("buscar_productos", {"texto": "audífonos", "categoria_id": None}),
        gemini_texto("Te recomiendo los Audífonos Bluetooth por $899.99."),
    )
    r = cliente_gemini.post("/chat", json={"mensaje": "Busco audífonos"})
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["modo"] == "ia"
    assert datos["respuesta"] == "Te recomiendo los Audífonos Bluetooth por $899.99."
    assert [p["id"] for p in datos["productos"]] == ["1"]

    primera, segunda = simulado.peticiones_gemini
    assert "gemini-flash-latest:generateContent" in primera["ruta"]
    assert primera["llave"] == "llave-gemini-prueba"
    assert "VinyLink" in primera["systemInstruction"]["parts"][0]["text"]
    nombres = {f["name"] for f in primera["tools"][0]["functionDeclarations"]}
    assert {"buscar_productos", "ver_pedido", "tipo_de_cambio"} <= nombres
    # Segunda vuelta: el turno del modelo con su firma y la respuesta de la herramienta.
    modelo, herramienta = segunda["contents"][-2:]
    assert modelo["parts"][0]["thoughtSignature"] == "c2lnbmF0dXJh"
    respuesta = herramienta["parts"][0]["functionResponse"]
    assert respuesta["name"] == "buscar_productos" and respuesta["id"] == "fc_1"
    assert respuesta["response"]["resultado"]["productos"][0]["nombre"] == "Audífonos Bluetooth"


def test_gemini_continua_la_conversacion_con_historial(cliente_gemini):
    simulado.gemini(gemini_texto("¡Hola! ¿Qué buscas?"), gemini_texto("Claro, tenemos vinilos."))
    conv = cliente_gemini.post("/chat", json={"mensaje": "hola"}).json()["conversacionId"]
    cliente_gemini.post("/chat", json={"mensaje": "¿tienen vinilos?", "conversacionId": conv})
    roles = [c["role"] for c in simulado.peticiones_gemini[-1]["contents"]]
    assert roles == ["user", "model", "user"]
    vista = cliente_gemini.get(f"/chat/{conv}").json()["mensajes"]
    assert [m["texto"] for m in vista][-1] == "Claro, tenemos vinilos."


def test_gemini_pedidos_con_sesion(cliente_gemini):
    simulado.gemini(gemini_llamada("mis_pedidos", {}), gemini_texto("Tu pedido #7 va en camino."))
    r = cliente_gemini.post("/chat", json={"mensaje": "¿y mi pedido?"}, headers=ANA)
    assert r.json()["respuesta"] == "Tu pedido #7 va en camino."
    respuesta = simulado.peticiones_gemini[-1]["contents"][-1]["parts"][0]["functionResponse"]["response"]
    assert respuesta["resultado"][0]["numeroGuia"] == "DHL123"


def test_gemini_bloqueo_de_seguridad_no_se_guarda(cliente_gemini):
    simulado.gemini(gemini_texto("", razon="SAFETY"))
    r = cliente_gemini.post("/chat", json={"mensaje": "algo indebido"}).json()
    assert "no puedo ayudarte" in r["respuesta"]


def test_gemini_llave_invalida_usa_el_modo_basico(cliente_gemini):
    simulado.status_gemini = 400
    r = cliente_gemini.post("/chat", json={"mensaje": "earbuds"})
    assert r.status_code == 200 and r.json()["modo"] == "basico"
    assert "Earbuds" in r.json()["respuesta"]
    assert cliente_gemini.get("/salud").json()["modo"] == "basico"


def test_gemini_cuota_agotada_usa_el_modo_basico(cliente_gemini):
    simulado.status_gemini = 429
    r = cliente_gemini.post("/chat", json={"mensaje": "earbuds"})
    assert r.status_code == 200 and r.json()["modo"] == "basico"


def test_gemini_modelo_inexistente_busca_el_flash_disponible(cliente_gemini):
    simulado.modelos_validos = {"gemini-2.5-flash"}
    simulado.gemini(gemini_texto("Hola, soy Vinny."), gemini_texto("Claro."))
    r = cliente_gemini.post("/chat", json={"mensaje": "hola"})
    assert r.status_code == 200, r.text
    assert r.json()["respuesta"] == "Hola, soy Vinny."
    assert "/v1beta/models/gemini-2.5-flash:generateContent" in simulado.peticiones_gemini[-1]["ruta"]
    assert cliente_gemini.get("/salud").json()["modelo"] == "gemini-2.5-flash"
    # El siguiente mensaje ya usa el modelo encontrado, sin volver a fallar.
    antes = len(simulado.peticiones_gemini)
    cliente_gemini.post("/chat", json={"mensaje": "otra"})
    assert len(simulado.peticiones_gemini) == antes + 1


def test_gemini_lento_usa_el_modo_basico(cliente_gemini, monkeypatch):
    from app.config import config
    monkeypatch.setattr(config(), "limite_ia_s", 0.5)
    simulado.demora_gemini = 2
    simulado.gemini(gemini_texto("tarde"))
    r = cliente_gemini.post("/chat", json={"mensaje": "earbuds"})
    assert r.status_code == 200 and r.json()["modo"] == "basico"
    assert "Earbuds" in r.json()["respuesta"]
