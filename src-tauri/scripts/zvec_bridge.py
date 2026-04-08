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


def _make_index_param(zvec, use_rabitq: bool):
    if use_rabitq and hasattr(zvec, "HnswRabitqIndexParam"):
        return zvec.HnswRabitqIndexParam(metric_type=zvec.MetricType.COSINE)
    return zvec.HnswIndexParam(metric_type=zvec.MetricType.COSINE)


def ensure_collection(zvec, collection_path: Path, collection_name: str, dimension: int, use_rabitq: bool = False):
    if collection_path.exists():
        return zvec.open(str(collection_path))

    collection_path.parent.mkdir(parents=True, exist_ok=True)
    schema = zvec.CollectionSchema(
        name=collection_name,
        vectors=zvec.VectorSchema(
            "embedding",
            zvec.DataType.VECTOR_FP32,
            dimension,
            index_param=_make_index_param(zvec, use_rabitq),
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


def cmd_probe_reranker():
    try:
        import_zvec()
        from zvec.extension import DefaultLocalReRanker  # type: ignore  # noqa: F401
    except ImportError as exc:
        emit(
            {
                "available": False,
                "message": str(exc),
                "hint": "pip install sentence-transformers",
            },
            ok=True,
        )

    try:
        import sentence_transformers  # type: ignore  # noqa: F401
    except ImportError:
        emit(
            {
                "available": False,
                "message": "sentence-transformers not installed",
                "hint": "pip install sentence-transformers",
            },
            ok=True,
        )

    emit({"available": True, "message": "reranker dependencies available"}, ok=True)


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
        use_rabitq=bool(payload.get("use_rabitq", False)),
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


def cmd_rerank(payload):
    zvec = import_zvec()
    from zvec.extension import DefaultLocalReRanker  # type: ignore

    query = payload["query"]
    documents = payload.get("documents", [])
    top_n = int(payload.get("top_n", 5))
    rerank_field = payload.get("rerank_field", "content")

    if not documents:
        emit({"hits": []}, ok=True)

    docs_dict = {
        "default": [
            zvec.Doc(id=doc["id"], fields={rerank_field: doc["content"]})
            for doc in documents
        ]
    }

    reranker = DefaultLocalReRanker(
        query=query, topn=top_n, rerank_field=rerank_field
    )
    reranked = reranker.rerank(docs_dict)

    hits = []
    for doc in reranked:
        hits.append(
            {"id": doc.id, "score": getattr(doc, "rerank_score", getattr(doc, "score", None))}
        )

    emit({"hits": hits}, ok=True)


def cmd_download_reranker_model(payload):
    model_name = payload.get("model", "cross-encoder/ms-marco-MiniLM-L6-v2")
    model_source = payload.get("model_source", "huggingface")

    try:
        import sentence_transformers  # type: ignore  # noqa: F401
    except ImportError:
        emit(
            {"success": False, "message": "sentence-transformers not installed"},
            ok=False,
            code=1,
        )

    sys.stderr.write(f"Downloading reranker model: {model_name} (source: {model_source})\n")
    sys.stderr.flush()

    if model_source == "modelscope":
        try:
            from modelscope import snapshot_download  # type: ignore
            cache_dir = snapshot_download(model_name)
            sys.stderr.write(f"Model downloaded via ModelScope to: {cache_dir}\n")
            sys.stderr.flush()
        except Exception as exc:
            emit(
                {"success": False, "message": f"ModelScope download failed: {exc}"},
                ok=False,
                code=1,
            )
    else:
        from sentence_transformers import CrossEncoder  # type: ignore
        CrossEncoder(model_name)

    sys.stderr.write("Model download complete\n")
    sys.stderr.flush()

    emit({"success": True, "model": model_name}, ok=True)


def cmd_search(payload):
    collection_path = Path(payload["collection_path"])
    if not collection_path.exists():
        emit({"hits": []}, ok=True)

    zvec = import_zvec()
    collection = zvec.open(str(collection_path))

    query_kwargs = dict(
        vectors=zvec.VectorQuery("embedding", payload["vector"]),
        topk=int(payload["topk"]),
    )
    if payload.get("use_rabitq") and hasattr(zvec, "HnswRabitqQueryParam"):
        query_kwargs["param"] = zvec.HnswRabitqQueryParam(ef=300)

    results = collection.query(**query_kwargs)

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
        elif command == "probe_reranker":
            cmd_probe_reranker()

        payload = load_payload()

        if command == "upsert":
            cmd_upsert(payload)
        elif command == "delete":
            cmd_delete(payload)
        elif command == "rerank":
            cmd_rerank(payload)
        elif command == "download_reranker_model":
            cmd_download_reranker_model(payload)
        elif command == "search":
            cmd_search(payload)
        else:
            emit({"error": f"Unsupported command: {command}"}, ok=False, code=1)
    except Exception as exc:  # pragma: no cover - runtime dependent
        emit({"error": str(exc)}, ok=False, code=1)


if __name__ == "__main__":
    main()
