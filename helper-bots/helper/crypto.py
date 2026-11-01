"""ChaCha20-Poly1305 (RFC 8439) in plain Python, for phone notes.

Why this cipher: Helper uses the standard library only, which has no AES, and Android has
"ChaCha20/Poly1305/NoPadding" built in from Android 9, so the phone and the PC can share one format
with no extra libraries. It is slow in pure Python, but notes are small.

Note file format (".hln"):  b"HLN1" + 12-byte nonce + ciphertext + 16-byte tag
The 4-byte header is also the associated data, so a changed header fails the check.
"""

from __future__ import annotations

import hmac
import os
import struct

MAGIC = b"HLN1"
_M32 = 0xFFFFFFFF


def _rotl(v: int, c: int) -> int:
    return ((v << c) & _M32) | (v >> (32 - c))


def _quarter(s: list[int], a: int, b: int, c: int, d: int) -> None:
    s[a] = (s[a] + s[b]) & _M32; s[d] = _rotl(s[d] ^ s[a], 16)  # noqa: E702
    s[c] = (s[c] + s[d]) & _M32; s[b] = _rotl(s[b] ^ s[c], 12)  # noqa: E702
    s[a] = (s[a] + s[b]) & _M32; s[d] = _rotl(s[d] ^ s[a], 8)   # noqa: E702
    s[c] = (s[c] + s[d]) & _M32; s[b] = _rotl(s[b] ^ s[c], 7)   # noqa: E702


def _block(key: bytes, counter: int, nonce: bytes) -> bytes:
    init = [0x61707865, 0x3320646E, 0x79622D32, 0x6B206574, *struct.unpack("<8I", key), counter & _M32,
            *struct.unpack("<3I", nonce)]
    s = list(init)
    for _ in range(10):
        _quarter(s, 0, 4, 8, 12); _quarter(s, 1, 5, 9, 13); _quarter(s, 2, 6, 10, 14); _quarter(s, 3, 7, 11, 15)  # noqa: E702
        _quarter(s, 0, 5, 10, 15); _quarter(s, 1, 6, 11, 12); _quarter(s, 2, 7, 8, 13); _quarter(s, 3, 4, 9, 14)  # noqa: E702
    return struct.pack("<16I", *((x + y) & _M32 for x, y in zip(s, init)))


def chacha20(key: bytes, counter: int, nonce: bytes, data: bytes) -> bytes:
    out = bytearray()
    for i in range(0, len(data), 64):
        ks = _block(key, counter + i // 64, nonce)
        chunk = data[i:i + 64]
        out += bytes(a ^ b for a, b in zip(chunk, ks))
    return bytes(out)


def poly1305(key: bytes, msg: bytes) -> bytes:
    r = int.from_bytes(key[:16], "little") & 0x0FFFFFFC0FFFFFFC0FFFFFFC0FFFFFFF
    s = int.from_bytes(key[16:], "little")
    p = (1 << 130) - 5
    acc = 0
    for i in range(0, len(msg), 16):
        n = int.from_bytes(msg[i:i + 16] + b"\x01", "little")
        acc = ((acc + n) * r) % p
    return ((acc + s) & ((1 << 128) - 1)).to_bytes(16, "little")


def _pad16(b: bytes) -> bytes:
    return b"\x00" * (-len(b) % 16)


def _tag(key: bytes, nonce: bytes, aad: bytes, ct: bytes) -> bytes:
    otk = _block(key, 0, nonce)[:32]
    mac = aad + _pad16(aad) + ct + _pad16(ct) + struct.pack("<QQ", len(aad), len(ct))
    return poly1305(otk, mac)


def seal(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    if len(key) != 32 or len(nonce) != 12:
        raise ValueError("key must be 32 bytes and nonce 12 bytes")
    ct = chacha20(key, 1, nonce, plaintext)
    return ct + _tag(key, nonce, aad, ct)


def open_(key: bytes, nonce: bytes, sealed: bytes, aad: bytes = b"") -> bytes:
    if len(key) != 32 or len(nonce) != 12 or len(sealed) < 16:
        raise ValueError("bad key, nonce or message")
    ct, tag = sealed[:-16], sealed[-16:]
    if not hmac.compare_digest(_tag(key, nonce, aad, ct), tag):
        raise ValueError("this note was changed or uses another key")
    return chacha20(key, 1, nonce, ct)


# ---------------------------------------------------------------- notes

def encrypt_note(key: bytes, text: str) -> bytes:
    nonce = os.urandom(12)
    return MAGIC + nonce + seal(key, nonce, text.encode("utf-8"), MAGIC)


def decrypt_note(key: bytes, blob: bytes) -> str:
    if blob[:4] != MAGIC or len(blob) < 4 + 12 + 16:
        raise ValueError("not a Helper note")
    return open_(key, blob[4:16], blob[16:], MAGIC).decode("utf-8")


def notes_key(home_root) -> bytes:
    """The shared key for phone notes, made once and kept in the secret folder (no tool can read it).
    A paired phone gets a copy when it pairs."""
    from pathlib import Path
    p = Path(home_root) / "secret" / "notes.key"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(os.urandom(32))
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
    key = p.read_bytes()
    if len(key) != 32:
        raise ValueError("secret/notes.key is damaged")
    return key
