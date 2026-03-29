#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def emit(payload, ok=True, code=0):
    body = {"ok": ok, **payload}
    sys.stdout.write(json.dumps(body, ensure_ascii=False))
    sys.stdout.flush()
    raise SystemExit(code)


def load_payload():
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def import_zvec():
    import zvec  # type: ignore

    return zvec


def ensure_collection(zvec, collection_path: Path, collection_name: str, dimension: int):
    if collection_path.exists():
        return zvec.open(str(collection_path))

    collection_path.parent.mkdir(parents=True, exist_ok=True)
    schema = zvec.CollectionSchema(
        name=collection_name,
        vectors=zvec.VectorSchema(
            "embedding",
            zvec.DataType.VECTOR_FP32,
            dimension,
            index_param=zvec.HnswIndexParam(metric_type=zvec.MetricType.COSINE),
        ),
    )
    return zvec.create_and_open(path=str(collection_path), schema=schema)


def cmd_probe():
    try:
        zvec = import_zvec()
    except Exception as exc:  # pragma: no cover - runtime dependent
        emit({"available": False, "version": None, "message": str(exc)}, ok=True)

    version = getattr(zvec, "__version__", None)
    emit({"available": True, "version": version, "message": "zvec import succeeded"}, ok=True)


def cmd_upsert(payload):
    zvec = import_zvec()
    docs = payload.get("docs", [])
    if not docs:
        emit({"upserted": 0, "optimized": False}, ok=True)

    collection_path = Path(payload["collection_path"])
    collection = ensure_collection(
        zvec,
        collection_path,
        payload["collection_name"],
        int(payload["dimension"]),
    )

    collection.upsert(
        [
            zvec.Doc(
                id=doc["id"],
                vectors={"embedding": doc["vector"]},
            )
            for doc in docs
        ]
    )

    optimized = bool(payload.get("optimize", True))
    if optimized:
        collection.optimize()

    emit({"upserted": len(docs), "optimized": optimized}, ok=True)


def cmd_delete(payload):
    collection_path = Path(payload["collection_path"])
    if not collection_path.exists():
        emit({"deleted": 0, "missing_collection": True}, ok=True)

    zvec = import_zvec()
    ids = payload.get("ids", [])
    if not ids:
        emit({"deleted": 0, "missing_collection": False}, ok=True)

    collection = zvec.open(str(collection_path))
    collection.delete(ids=ids)
    emit({"deleted": len(ids), "missing_collection": False}, ok=True)


def cmd_search(payload):
    collection_path = Path(payload["collection_path"])
    if not collection_path.exists():
        emit({"hits": []}, ok=True)

    zvec = import_zvec()
    collection = zvec.open(str(collection_path))
    results = collection.query(
        vectors=zvec.VectorQuery("embedding", payload["vector"]),
        topk=int(payload["topk"]),
    )

    hits = [
        {
            "id": doc.id,
            "score": getattr(doc, "score", None),
        }
        for doc in results
    ]
    emit({"hits": hits}, ok=True)


def main():
    if len(sys.argv) < 2:
        emit({"error": "Missing command"}, ok=False, code=1)

    command = sys.argv[1]

    try:
        if command == "probe":
            cmd_probe()

        payload = load_payload()

        if command == "upsert":
            cmd_upsert(payload)
        elif command == "delete":
            cmd_delete(payload)
        elif command == "search":
            cmd_search(payload)
        else:
            emit({"error": f"Unsupported command: {command}"}, ok=False, code=1)
    except Exception as exc:  # pragma: no cover - runtime dependent
        emit({"error": str(exc)}, ok=False, code=1)


if __name__ == "__main__":
    main()
