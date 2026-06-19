"""Pydantic request and response models for the screen endpoint."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Filter(BaseModel):
    """A single filter clause."""

    field: str
    op: str = ">"
    value: Any = None


class Computed(BaseModel):
    """A user-defined computed column."""

    id: str
    expr: str


class Stat(BaseModel):
    """An in-result statistic request."""

    fn: str  # zscore | pctrank | rank | norm | madzscore
    field: str


class FactorWeight(BaseModel):
    """One weighted field in a composite factor score."""

    field: str
    weight: float = 1.0
    dir: str = "high"  # high | low


class Factor(BaseModel):
    """Composite factor scoring request."""

    weights: list[FactorWeight] = Field(default_factory=list)


class SortKey(BaseModel):
    """A single sort key."""

    field: str
    dir: str = "desc"  # asc | desc


class ScreenRequest(BaseModel):
    """Body of POST /api/screen."""

    market: str = "america"
    columns: list[str] = Field(default_factory=list)
    filters: list[Filter] = Field(default_factory=list)
    match: str = "all"  # all | any
    computed: list[Computed] = Field(default_factory=list)
    stats: list[Stat] = Field(default_factory=list)
    factor: Factor | None = None
    sort: list[SortKey] = Field(default_factory=list)
    limit: int = 150
    offset: int = 0


class ScreenMeta(BaseModel):
    """Metadata about how a screen was served."""

    cached: bool = False
    ms: int = 0
    market: str = "america"
    error: str | None = None


class ScreenResponse(BaseModel):
    """Response of POST /api/screen."""

    count: int = 0
    rows: list[dict] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    meta: ScreenMeta = Field(default_factory=ScreenMeta)
