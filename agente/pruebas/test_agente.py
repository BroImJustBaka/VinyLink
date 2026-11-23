"""Pruebas del asistente con IA y de las reseñas."""

import json

from conftest import herramienta, mensaje, simulado, texto

ANA = {"Authorization": "Bearer tok-ana"}
BETO = {"Authorization": "Bearer tok-beto"}


def resultados_de_herramientas(peticion):
    """Bloques tool_result del último mensaje de una petición a Claude."""
    return [b for b in peticion["messages"][-1]["content"] if b.get("type") == "tool_result"]


# ------------------------------------------------------------ servicio
def test_salud(cliente):
    r = cliente.get("/salud")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "mongo": True, "ia": "claude", "modo": "ia", "modelo": "claude-haiku-5-5"}


def test_sin_clave_interna_se_rechaza(cliente):
    r = cliente.post("/chat", json={"mensaje": "hola"}, headers={"X-Clave-Interna": "otra"})
    assert r.status_code == 401


def test_mensaje_vacio_o_muy_largo(cliente):
    assert cliente.post("/chat", json={"mensaje": ""}).status_code == 422
    assert cliente.post("/chat", json={"mensaje": "x" * 1001}).status_code == 422


# ------------------------------------------------------------ chat
def test_busca_productos_y_regresa_tarjetas(cliente):
    simulado.claude(
        herramienta("buscar_productos", {"texto": "audífonos", "categoria_id": None}),
        texto("Te recomiendo los Audífonos Bluetooth por $899.99."),
    )
    r = cliente.post("/chat", json={"mensaje": "Busco audífonos baratos"})
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["respuesta"] == "Te recomiendo los Audífonos Bluetooth por $899.99."
    # Solo productos con existencias (los de estudio tienen stock 0).
    assert [p["id"] for p in datos["productos"]] == ["1"]
    assert set(datos["productos"][0]) == {"id", "nombre", "precio", "stock", "imagen"}

    primera, segunda = simulado.peticiones_claude
    assert primera["model"] == "claude-haiku-5-5"
    assert primera["output_config"] == {"effort": "low"}
    assert "VinyLink" in primera["system"]
    assert all(h["strict"] and h["input_schema"]["additionalProperties"] is False for h in primera["tools"])
    assert "temperature" not in primera
    # El resultado de la herramienta vuelve a Claude con los productos reales.
    (resultado,) = resultados_de_herramientas(segunda)
    assert resultado["tool_use_id"] == "toolu_1"
    assert json.loads(resultado["content"])["productos"][0]["nombre"] == "Audífonos Bluetooth"


def test_la_conversacion_continua_con_el_historial_completo(cliente):
    simulado.claude(herramienta("buscar_productos", {"texto": "audífonos", "categoria_id": None}), texto("Hay dos modelos."))
    conv = cliente.post("/chat", json={"mensaje": "¿Qué audífonos tienen?"}).json()["conversacionId"]
    simulado.claude(texto("Los Bluetooth cuestan $899.99."))
    r = cliente.post("/chat", json={"mensaje": "¿Y cuánto cuestan?", "conversacionId": conv})
    assert r.json()["conversacionId"] == conv

    ultima = simulado.peticiones_claude[-1]["messages"]
    assert [m["role"] for m in ultima] == ["user", "assistant", "user", "assistant", "user"]
    # El bloque de pensamiento se reenvía sin cambios (con su firma).
    assert ultima[1]["content"][0] == {"type": "thinking", "thinking": "", "signature": "firma-123"}
    assert ultima[-1] == {"role": "user", "content": "¿Y cuánto cuestan?"}

    historial = cliente.get(f"/chat/{conv}").json()["mensajes"]
    assert [m["rol"] for m in historial] == ["cliente", "asistente", "cliente", "asistente"]
    assert historial[-1]["texto"] == "Los Bluetooth cuestan $899.99."


def test_pedidos_sin_sesion(cliente):
    simulado.claude(herramienta("mis_pedidos", {}), texto("Inicia sesión en /login para ver tus pedidos."))
    cliente.post("/chat", json={"mensaje": "¿Dónde está mi pedido?"})
    (resultado,) = resultados_de_herramientas(simulado.peticiones_claude[-1])
    assert "no tiene la sesión" in resultado["content"]
    assert not any(p["query"].strip().startswith("{ misPedidos") for p in simulado.peticiones_tienda)


def test_pedidos_con_sesion_usan_el_token_del_cliente(cliente):
    simulado.claude(
        herramienta("mis_pedidos", {}, "toolu_a"),
        herramienta("ver_pedido", {"pedido_id": "#7"}, "toolu_b", pensamiento=False),
        texto("Tu pedido #7 va en camino con DHL (guía DHL123)."),
    )
    r = cliente.post("/chat", json={"mensaje": "¿Cómo va mi pedido?"}, headers=ANA)
    assert "DHL123" in r.json()["respuesta"]
    consultas = [p for p in simulado.peticiones_tienda if "misPedidos" in p["query"] or "pedido(" in p["query"]]
    assert consultas and all(p["token"] == "tok-ana" for p in consultas)
    (resultado,) = resultados_de_herramientas(simulado.peticiones_claude[-1])
    assert json.loads(resultado["content"])["numeroGuia"] == "DHL123"


def test_pedido_ajeno_es_error_de_herramienta(cliente):
    simulado.claude(herramienta("ver_pedido", {"pedido_id": "7"}), texto("No encuentro ese pedido."))
    cliente.post("/chat", json={"mensaje": "Pedido 7"}, headers=BETO)
    (resultado,) = resultados_de_herramientas(simulado.peticiones_claude[-1])
    assert resultado.get("is_error") is True and "No existe el pedido" in resultado["content"]


def test_otra_persona_no_ve_ni_continua_una_conversacion(cliente):
    simulado.claude(texto("Hola Ana."))
    conv = cliente.post("/chat", json={"mensaje": "Hola"}, headers=ANA).json()["conversacionId"]
    assert cliente.get(f"/chat/{conv}", headers=BETO).status_code == 404
    assert cliente.get(f"/chat/{conv}").status_code == 404
    simulado.claude(texto("Hola Beto."))
    r = cliente.post("/chat", json={"mensaje": "Hola", "conversacionId": conv}, headers=BETO)
    assert r.json()["conversacionId"] != conv  # se le abre una conversación nueva
    assert len(simulado.peticiones_claude[-1]["messages"]) == 1


def test_varias_herramientas_en_paralelo_en_un_solo_mensaje(cliente):
    simulado.claude(
        mensaje(
            [
                {"type": "tool_use", "id": "t1", "name": "tipo_de_cambio", "input": {}},
                {"type": "tool_use", "id": "t2", "name": "ver_producto", "input": {"producto_id": "3"}},
            ],
            stop="tool_use",
        ),
        texto("Los Earbuds cuestan unos US$38."),
    )
    r = cliente.post("/chat", json={"mensaje": "¿Cuánto cuestan los earbuds en dólares?"})
    resultados = resultados_de_herramientas(simulado.peticiones_claude[-1])
    assert [x["tool_use_id"] for x in resultados] == ["t1", "t2"]
    assert json.loads(resultados[1]["content"])["resenas"] == {"promedio": None, "total": 0, "porEstrella": {str(i): 0 for i in range(1, 6)}}
    assert r.json()["productos"][0]["id"] == "3"


def test_limite_de_vueltas_de_herramientas(cliente):
    from app.config import config

    config().max_vueltas_herramientas = 2
    simulado.claude(
        herramienta("listar_categorias", {}, "a"), herramienta("listar_categorias", {}, "b"), texto("Tenemos audífonos.")
    )
    r = cliente.post("/chat", json={"mensaje": "categorías"})
    assert r.json()["respuesta"] == "Tenemos audífonos."
    assert simulado.peticiones_claude[-1]["tool_choice"] == {"type": "none"}


def test_rechazo_no_se_guarda_en_el_historial(cliente):
    simulado.claude(texto("Hola."))
    conv = cliente.post("/chat", json={"mensaje": "hola"}).json()["conversacionId"]
    simulado.claude(mensaje([], stop="refusal"))
    r = cliente.post("/chat", json={"mensaje": "algo indebido", "conversacionId": conv})
    assert "no puedo ayudarte" in r.json()["respuesta"]
    simulado.claude(texto("Claro."))
    cliente.post("/chat", json={"mensaje": "¿tienen vinilos?", "conversacionId": conv})
    assert [m["role"] for m in simulado.peticiones_claude[-1]["messages"]] == ["user", "assistant", "user"]


def test_api_key_invalida_usa_el_modo_basico(cliente):
    simulado.status_claude = 401
    r = cliente.post("/chat", json={"mensaje": "quiero unos audífonos"})
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["modo"] == "basico"
    assert "Audífonos Bluetooth" in datos["respuesta"]
    assert [p["id"] for p in datos["productos"]] == ["1"]  # sin existencias no hay tarjeta
    assert cliente.get("/salud").json()["modo"] == "basico"


def test_sin_saldo_usa_el_modo_basico_y_no_reintenta_enseguida(cliente):
    simulado.status_claude = 400
    simulado.error_claude = {"type": "error", "error": {"type": "invalid_request_error",
                             "message": "Your credit balance is too low to access the Anthropic API."}}
    r = cliente.post("/chat", json={"mensaje": "audífonos"})
    assert r.status_code == 200 and r.json()["modo"] == "basico"
    llamadas = len(simulado.peticiones_claude)
    r = cliente.post("/chat", json={"mensaje": "¿a cuánto está el dólar?", "conversacionId": r.json()["conversacionId"]})
    assert "18.35" in r.json()["respuesta"]
    assert len(simulado.peticiones_claude) == llamadas  # en pausa: no se vuelve a llamar a Claude


def test_modo_basico_pedidos(cliente):
    simulado.status_claude = 529
    assert "inicia sesión" in cliente.post("/chat", json={"mensaje": "¿dónde está mi pedido?"}).json()["respuesta"]
    r = cliente.post("/chat", json={"mensaje": "¿dónde está mi pedido?"}, headers=ANA).json()
    assert "#7" in r["respuesta"] and "DHL123" in r["respuesta"]


def test_peticion_invalida_que_no_es_de_saldo_sigue_siendo_error(cliente):
    simulado.status_claude = 400
    simulado.error_claude = {"type": "error", "error": {"type": "invalid_request_error", "message": "messages: roles must alternate"}}
    r = cliente.post("/chat", json={"mensaje": "hola"})
    assert r.status_code == 400


def test_sin_api_key_usa_el_modo_basico(cliente, monkeypatch):
    monkeypatch.setattr(cliente.app.state.agente, "cliente", None)
    r = cliente.post("/chat", json={"mensaje": "earbuds"})
    assert r.status_code == 200 and r.json()["modo"] == "basico"
    assert simulado.peticiones_claude == []


def test_limite_de_mensajes_por_persona(cliente):
    from app.config import config

    config().limite_mensajes = 2
    simulado.claude(texto("1"), texto("2"), texto("3"))
    estados = [cliente.post("/chat", json={"mensaje": "hola"}, headers={"X-Cliente-IP": "1.2.3.4"}).status_code for _ in range(3)]
    assert estados == [200, 200, 429]
    # Otra IP tiene su propio límite.
    assert cliente.post("/chat", json={"mensaje": "hola"}, headers={"X-Cliente-IP": "5.6.7.8"}).status_code == 200


# ------------------------------------------------------------ reseñas
def test_resenas(cliente):
    url = "/productos/1/resenas"
    assert cliente.get(url).json() == {"promedio": None, "total": 0, "porEstrella": {str(i): 0 for i in range(1, 6)}, "resenas": []}
    nueva = {"calificacion": 5, "titulo": "Excelentes", "texto": "Suenan muy bien y la batería dura mucho."}
    assert cliente.post(url, json=nueva).status_code == 401
    assert cliente.post(url, json={**nueva, "calificacion": 6}, headers=ANA).status_code == 422
    assert cliente.post(url, json={**nueva, "texto": "corto"}, headers=ANA).status_code == 422

    datos = cliente.post(url, json=nueva, headers=ANA).json()
    (r,) = datos["resenas"]
    assert r["autor"] == "Ana María L." and r["compraVerificada"] is True and r["esMia"] is True

    # La segunda reseña del mismo cliente reemplaza la primera.
    datos = cliente.post(url, json={**nueva, "calificacion": 4}, headers=ANA).json()
    assert datos["total"] == 1 and datos["promedio"] == 4

    datos = cliente.post(url, json={**nueva, "calificacion": 1, "titulo": "No me gustaron"}, headers=BETO).json()
    assert datos["total"] == 2 and datos["promedio"] == 2.5
    beto = next(x for x in datos["resenas"] if x["autor"] == "Beto")
    assert beto["compraVerificada"] is False  # Beto no compró el producto

    publico = cliente.get(url).json()
    assert all(x["esMia"] is False for x in publico["resenas"])
    assert publico["porEstrella"]["4"] == 1 and publico["porEstrella"]["1"] == 1

    assert cliente.delete(f"{url}/mia", headers=BETO).json()["total"] == 1
    assert cliente.delete(f"{url}/mia", headers=BETO).status_code == 404


def test_resena_de_producto_inexistente(cliente):
    nueva = {"calificacion": 5, "titulo": "Bien", "texto": "Producto que no existe."}
    assert cliente.post("/productos/999/resenas", json=nueva, headers=ANA).status_code == 404
    assert cliente.get("/productos/abc/resenas").status_code == 404
