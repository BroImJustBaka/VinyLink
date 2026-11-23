"""MongoDB en memoria para las pruebas: mongomock envuelto con la API asíncrona
de PyMongo (`AsyncMongoClient`) que usa el servicio. Solo cubre lo que el
código usa; si se usa un método nuevo, la prueba falla con AttributeError."""

import mongomock


class _Cursor:
    def __init__(self, cursor):
        self._c = cursor

    def sort(self, *args, **kwargs):
        self._c = self._c.sort(*args, **kwargs)
        return self

    def limit(self, n):
        self._c = self._c.limit(n)
        return self

    async def to_list(self, length=None):
        docs = list(self._c)
        return docs if length is None else docs[:length]


class _Coleccion:
    def __init__(self, col):
        self._col = col

    def find(self, *args, **kwargs):
        return _Cursor(self._col.find(*args, **kwargs))

    async def aggregate(self, pipeline):
        return _Cursor(iter(list(self._col.aggregate(pipeline))))

    def __getattr__(self, nombre):
        metodo = getattr(self._col, nombre)

        async def asincrono(*args, **kwargs):
            return metodo(*args, **kwargs)

        return asincrono


class _BaseDeDatos:
    def __init__(self, db):
        self._db = db

    async def command(self, comando):
        return {"ok": 1.0}

    def __getattr__(self, nombre):
        return _Coleccion(self._db[nombre])

    __getitem__ = __getattr__


class ClienteMongoFalso:
    def __init__(self):
        self._cliente = mongomock.MongoClient(tz_aware=True)

    def __getitem__(self, nombre):
        return _BaseDeDatos(self._cliente[nombre])

    async def close(self):
        pass
