"""Every resource client and input type is importable from ``stigmer``.

The generator writes one module per resource under ``stigmer._gen`` and lists
each module's client and inputs in ``stigmer._gen.__all__``. A reader copies
``from stigmer import TeamInput``, never the private module, so every one of
those names must reach the package: imported in ``stigmer/__init__.py`` and
named in its ``__all__`` (type checkers read ``__all__`` to decide what a
``py.typed`` package exports). A resource the generator learns without the
package exporting it fails here, naming what is missing.
"""

from __future__ import annotations

import collections

import stigmer
import stigmer._gen as gen

# The generated base class every resource client extends; an internal, like
# the stream and error helpers ``stigmer._gen`` lists beside the resources.
_INTERNAL = {"GeneratedClient"}


def _resource_names() -> list[str]:
    return [
        name
        for name in gen.__all__
        if (name.endswith("Client") or name.endswith("Input")) and name not in _INTERNAL
    ]


def test_the_generated_package_lists_resource_clients_and_inputs() -> None:
    names = _resource_names()
    assert "AgentClient" in names
    assert "TeamInput" in names


def test_every_resource_client_and_input_is_exported_from_the_package() -> None:
    missing_attr = [name for name in _resource_names() if not hasattr(stigmer, name)]
    missing_all = [name for name in _resource_names() if name not in stigmer.__all__]
    assert missing_attr == [], f"not importable from stigmer: {missing_attr}"
    assert missing_all == [], f"not in stigmer.__all__: {missing_all}"


def test_each_exported_name_is_the_generated_object() -> None:
    for name in _resource_names():
        assert getattr(stigmer, name) is getattr(gen, name), name


def test_the_package_exports_list_names_each_attribute_once() -> None:
    twice = [name for name, n in collections.Counter(stigmer.__all__).items() if n > 1]
    absent = [name for name in stigmer.__all__ if not hasattr(stigmer, name)]
    assert twice == [], f"listed twice in stigmer.__all__: {twice}"
    assert absent == [], f"listed in stigmer.__all__ but not defined: {absent}"


def test_no_internal_is_exported() -> None:
    internals = {"GeneratedClient", "BidiStream", "wrap_error", "is_unimplemented"}
    assert internals.isdisjoint(stigmer.__all__)
