from __future__ import annotations

import functools
import ipaddress
import socket
from typing import Iterable
from urllib.parse import urlparse

import httpx

from .config import settings


class UnsafeOutboundUrlError(ValueError):
    pass


def _is_blocked_ip(value: ipaddress._BaseAddress) -> bool:
    return (
        value.is_private
        or value.is_loopback
        or value.is_link_local
        or value.is_multicast
        or value.is_reserved
        or value.is_unspecified
    )


@functools.lru_cache(maxsize=512)
def _resolve_host_ips(hostname: str) -> tuple[ipaddress._BaseAddress, ...]:
    records = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    resolved: list[ipaddress._BaseAddress] = []
    for record in records:
        sockaddr = record[4]
        if not sockaddr:
            continue
        ip_raw = sockaddr[0]
        try:
            resolved.append(ipaddress.ip_address(ip_raw))
        except ValueError:
            continue
    if not resolved:
        raise UnsafeOutboundUrlError("无法解析目标地址")
    unique = {(item.version, item.compressed): item for item in resolved}
    return tuple(unique.values())


def ensure_safe_outbound_url(raw_url: str) -> str:
    value = str(raw_url or "").strip()
    if not value:
        raise UnsafeOutboundUrlError("URL 不能为空")
    parsed = urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeOutboundUrlError("仅允许 http/https URL")
    if not parsed.hostname:
        raise UnsafeOutboundUrlError("URL 缺少主机名")
    if parsed.username or parsed.password:
        raise UnsafeOutboundUrlError("URL 不允许内嵌凭据")
    if settings.network_block_private:
        addresses: tuple[ipaddress._BaseAddress, ...]
        try:
            addresses = (ipaddress.ip_address(parsed.hostname),)
        except ValueError:
            addresses = _resolve_host_ips(parsed.hostname)
        if any(_is_blocked_ip(item) for item in addresses):
            raise UnsafeOutboundUrlError("目标地址属于受保护网段")
    return value


def _read_limited_chunks(chunks: Iterable[bytes], limit_bytes: int) -> bytes:
    data = bytearray()
    for chunk in chunks:
        if not chunk:
            continue
        data.extend(chunk)
        if len(data) > limit_bytes:
            raise UnsafeOutboundUrlError("远程响应体过大")
    return bytes(data)


async def _read_limited_async_chunks(chunks, limit_bytes: int) -> bytes:
    data = bytearray()
    async for chunk in chunks:
        if not chunk:
            continue
        data.extend(chunk)
        if len(data) > limit_bytes:
            raise UnsafeOutboundUrlError("远程响应体过大")
    return bytes(data)


def fetch_text_response(
    client: httpx.Client,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    limit_bytes: int | None = None,
) -> tuple[httpx.Response, str]:
    safe_url = ensure_safe_outbound_url(url)
    max_bytes = max(1024, int(limit_bytes or settings.network_max_response_bytes))
    with client.stream("GET", safe_url, headers=headers) as response:
        response.raise_for_status()
        payload = _read_limited_chunks(response.iter_bytes(), max_bytes)
        text = payload.decode(response.encoding or "utf-8", errors="replace")
        return response, text


def fetch_bytes_response(
    client: httpx.Client,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    limit_bytes: int | None = None,
) -> tuple[httpx.Response, bytes]:
    safe_url = ensure_safe_outbound_url(url)
    max_bytes = max(1024, int(limit_bytes or settings.network_max_response_bytes))
    with client.stream("GET", safe_url, headers=headers) as response:
        response.raise_for_status()
        payload = _read_limited_chunks(response.iter_bytes(), max_bytes)
        return response, payload


async def fetch_text_response_async(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    limit_bytes: int | None = None,
) -> tuple[httpx.Response, str]:
    safe_url = ensure_safe_outbound_url(url)
    max_bytes = max(1024, int(limit_bytes or settings.network_max_response_bytes))
    async with client.stream("GET", safe_url, headers=headers) as response:
        response.raise_for_status()
        payload = await _read_limited_async_chunks(response.aiter_bytes(), max_bytes)
        text = payload.decode(response.encoding or "utf-8", errors="replace")
        return response, text
