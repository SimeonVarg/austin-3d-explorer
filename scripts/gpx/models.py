"""Importer settings and local records."""

from __future__ import annotations
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PRIVACY_DEFAULT = "privacy-circles.json"


@dataclass
class Settings:
    max_accuracy: float = 30.0
    hdop_metres: float = 5.0
    vehicle_speed: float = 3.0
    vehicle_seconds: float = 20.0
    gap_seconds: float = 120.0
    door_radius: float = 25.0
    wall_radius: float = 20.0
    inside_seconds: float = 8.0
    through_seconds: float = 300.0
    offgraph_distance: float = 12.0
    offgraph_length: float = 20.0
    walk_speed: float = 1.35
    public_grid: float = 5.0


@dataclass
class Fix:
    position: tuple
    time: datetime
    elevation: float | None = None
    accuracy: float | None = None
    hdop: float | None = None
    accuracy_source: str = "unknown"
    session: int = 0
    collapse_after: datetime | None = None
    recovery_before: datetime | None = None


@dataclass
class Door:
    identifier: int
    building: str
    position: tuple
    source: str


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))
