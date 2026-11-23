"""Configuración del microservicio, leída de variables de entorno (o de agente/.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Configuracion(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Gemini (Google AI Studio, plan gratuito) --- tiene prioridad sobre Claude.
    gemini_api_key: str | None = None
    gemini_modelo: str = "gemini-flash-lite-latest"
    # Se usa cuando el principal está saturado (503), sin cuota (429) o no contesta a tiempo.
    gemini_modelo_respaldo: str = "gemini-flash-latest"

    # --- Claude (Anthropic, opcional y prepagado) ---
    # La SDK lee ANTHROPIC_API_KEY sola; aquí solo se usa para saber si existe.
    anthropic_api_key: str | None = None
    modelo: str = "claude-haiku-5-5"
    # Respuestas cortas de chat: esfuerzo bajo (más rápido y barato).
    esfuerzo: str = "low"
    max_vueltas_herramientas: int = 6
    # Tiempo máximo para que la IA conteste; después se responde en modo básico
    # (la tienda corta la petición a los 90 s).
    limite_ia_s: float = 70
    max_turnos_conversacion: int = 30

    # --- MongoDB (conversaciones del asistente y reseñas) ---
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "vinylink"

    # --- Backend GraphQL de la tienda (Node) ---
    backend_graphql_url: str = "http://localhost:4000/"

    # --- Seguridad ---
    # Clave compartida con el proxy de la web (web/src/pages/api/agente).
    # Vacía = no se exige (solo para desarrollo local).
    agente_clave_interna: str | None = None
    # Límite de mensajes al asistente por persona (IP o usuario) por ventana.
    limite_mensajes: int = 20
    ventana_limite_segundos: int = 300


@lru_cache
def config() -> Configuracion:
    return Configuracion()
