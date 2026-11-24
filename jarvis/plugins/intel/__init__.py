"""Intelligence layer plugin (first slice).

Aggregates the existing opportunity leads and bug-bounty
programs/findings into one geo-tagged, read-only view for the Earth
globe. Locations come from explicit lead coordinates when set, else
from a curated city / company-HQ lookup over the item's text — no
network geocoding, no keys, no writes to the source stores.
See docs/intel.md.
"""
from __future__ import annotations

from .geo import CITY_COORDS, COMPANY_HQ, resolve_location, valid_coords
from .store import IntelStore
from .tools import register

__all__ = [
    "CITY_COORDS",
    "COMPANY_HQ",
    "IntelStore",
    "register",
    "resolve_location",
    "valid_coords",
]
