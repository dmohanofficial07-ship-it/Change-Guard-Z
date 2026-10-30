import msgpack


def serialize_job(payload: dict) -> bytes:
    return msgpack.packb(payload, use_bin_type=True)


def deserialize_job(payload: bytes) -> dict:
    return msgpack.unpackb(payload, raw=False)
