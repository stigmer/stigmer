"""Every annotation on a generated client resolves to a real type.

The generated modules start with ``from __future__ import annotations``, so
Python never evaluates their annotations at run time, and an annotation that
names a type its module does not define fails nowhere until an editor or a
type checker reads it. ``typing.get_type_hints`` evaluates each one against
the module's own imports, so a method annotated with a module that lacks the
type (a request type named on the wrong ``*_pb2``) fails here instead.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
import typing

import stigmer._gen as gen


def _generated_modules() -> list[object]:
    return [
        importlib.import_module(f"{gen.__name__}.{info.name}")
        for info in pkgutil.iter_modules(gen.__path__)
    ]


def _client_classes() -> list[type]:
    classes: list[type] = []
    for module in _generated_modules():
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ == module.__name__ and cls.__name__.endswith("Client"):  # type: ignore[attr-defined]
                classes.append(cls)
    return classes


class TestGeneratedAnnotations:
    def test_the_generated_clients_are_found(self) -> None:
        names = {cls.__name__ for cls in _client_classes()}
        assert {"AgentClient", "IdentityAccountClient", "SessionClient"} <= names

    def test_every_public_method_annotation_resolves(self) -> None:
        unresolved: list[str] = []
        for cls in _client_classes():
            for name, fn in inspect.getmembers(cls, inspect.isfunction):
                if name.startswith("_"):
                    continue
                try:
                    typing.get_type_hints(fn)
                except Exception as e:  # noqa: BLE001 - every failure is the finding
                    unresolved.append(f"{cls.__name__}.{name}: {type(e).__name__}: {e}")
        assert unresolved == []
