from __future__ import annotations

import importlib
from pathlib import Path
from typing import Iterable

from .config import settings


def _discover_plugins() -> list[str]:
    root = Path(__file__).resolve().parent / "plugins"
    if not root.exists():
        return []
    names: list[str] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if child.name.startswith("_"):
            continue
        if not (child / "plugin.py").exists():
            continue
        names.append(child.name)
    return sorted(names)


def list_available_plugins() -> list[str]:
    return _discover_plugins()


def iter_enabled_plugins() -> Iterable[str]:
    if settings.plugins.strip() == "":
        return []
    configured = [p.strip() for p in settings.plugins.split(",") if p.strip()]
    if configured:
        seen: set[str] = set()
        ordered: list[str] = []
        for name in configured:
            if name in seen:
                continue
            seen.add(name)
            ordered.append(name)
        return ordered
    return _discover_plugins()


def load_plugins(app) -> None:
    for plugin_name in iter_enabled_plugins():
        module_path = f"backend.plugins.{plugin_name}.plugin"
        try:
            module = importlib.import_module(module_path)
        except Exception:  # noqa: BLE001
            continue
        register = getattr(module, "register", None)
        if callable(register):
            register(app)
