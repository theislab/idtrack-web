"""The schemas of the api's requests and responses.

The results of idtrack (:py:data:`idtrack_web_api.adapter.RESULT_CLASSES`) are frozen dataclasses whose
``to_dict()`` is what the api sends, unchanged. Their response schemas are made here from those dataclasses: one
field per dataclass field, in the same order, every field required (``to_dict()`` writes every key), with the
field's text from the dataclass's docstring. So the schema follows idtrack exactly, and a change of idtrack's results
shows as a change of ``api/openapi.json``, which a test compares with what the app serves.
"""

from __future__ import annotations

import dataclasses
import inspect
import re
import types
import typing
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model

from idtrack_web_api.adapter import RESULT_CLASSES

_STRICT = ConfigDict(extra="forbid", strict=True, frozen=True)
_ATTRIBUTE = re.compile(r"^(?P<name>[A-Za-z_][A-Za-z0-9_]*) \((?P<type>.+?)\): (?P<text>.*)$")


_ROLE = re.compile(r":py:\w+:`~?([^`]+)`")
_LITERAL = re.compile(r"``([^`]+)``")


def plain_text(text: str) -> str:
    """Return docstring text with Sphinx roles and double back quotes as plain Markdown code spans.

    Args:
        text: Docstring text.

    Returns:
        str: The text with ``:py:attr:`~a.b``` as ```b``` (the last part where the docstring asks for it with ``~``,
        else the whole name) and double back quotes as single ones.
    """

    def role(match: re.Match[str]) -> str:
        name = match.group(1)
        return f"`{name.rsplit('.', 1)[-1]}`" if match.group(0).count("`~") else f"`{name}`"

    return _LITERAL.sub(r"`\1`", _ROLE.sub(role, text))


def attribute_docs(cls: type) -> dict[str, str]:
    """Return the text of each attribute of a Google-style ``Attributes:`` section of a class's docstring.

    Args:
        cls: The class.

    Returns:
        dict[str, str]: Attribute name to its text, continuation lines joined by single spaces.
    """
    doc = inspect.getdoc(cls) or ""
    lines = doc.splitlines()
    try:
        start = lines.index("Attributes:") + 1
    except ValueError:
        return {}
    docs: dict[str, str] = {}
    current: str | None = None
    for line in lines[start:]:
        if line and not line.startswith(" "):
            break
        stripped = line.strip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip(" "))
        match = _ATTRIBUTE.match(stripped) if indent == 4 else None
        if match:
            current = match["name"]
            docs[current] = match["text"].strip()
        elif current is not None:
            docs[current] += " " + stripped
    return {name: plain_text(text) for name, text in docs.items()}


def _summary(cls: type) -> str:
    """Return the docstring of a class up to its ``Attributes:`` section."""
    doc = inspect.getdoc(cls) or ""
    return plain_text(doc.split("\nAttributes:")[0].strip())


_MODELS: dict[type, type[BaseModel]] = {}


def _translate(annotation: Any) -> Any:
    """Replace every result dataclass inside a type by its model."""
    if isinstance(annotation, type) and dataclasses.is_dataclass(annotation):
        return model_of(annotation)
    origin = typing.get_origin(annotation)
    if origin is None:
        return annotation
    args = tuple(_translate(a) for a in typing.get_args(annotation))
    if origin in (typing.Union, types.UnionType):
        return typing.Union[args]  # noqa: UP007 - built from a runtime tuple of types
    return origin[args]


def model_of(cls: type) -> type[BaseModel]:
    """Return the response model of one of idtrack's result dataclasses (made once).

    Args:
        cls: A dataclass of :py:mod:`idtrack.results`.

    Returns:
        type[BaseModel]: The model: the dataclass's fields in order, all required, documented from its docstring.

    Raises:
        TypeError: If a field of the dataclass has no text in its docstring (the schema would be undocumented).
    """
    if cls in _MODELS:
        return _MODELS[cls]
    hints = typing.get_type_hints(cls)
    docs = attribute_docs(cls)
    definitions: dict[str, Any] = {}
    for f in dataclasses.fields(cls):
        if f.name not in docs:
            raise TypeError(f"{cls.__name__}.{f.name} has no text in the docstring of {cls.__name__}.")
        definitions[f.name] = (_translate(hints[f.name]), Field(..., description=docs[f.name]))
    model: type[BaseModel] = create_model(
        cls.__name__, __config__=_STRICT, __doc__=_summary(cls), __module__=__name__, **definitions
    )
    _MODELS[cls] = model
    return model


ConversionResultModel = model_of(RESULT_CLASSES["ConversionResult"])
GraphDescriptionModel = model_of(RESULT_CLASSES["GraphDescription"])
NameMatchModel = model_of(RESULT_CLASSES["NameMatch"])


# ------------------------------------------------------------------------------------------------------------------
# The api's own responses


class ValidationDetail(BaseModel):
    """One problem of a request that does not have the shape the endpoint takes."""

    model_config = _STRICT
    location: list[str | int] = Field(
        ..., description="Where the problem is: `query`, `path` or `body`, then the field."
    )
    message: str = Field(..., description="What is wrong.")


class ErrorBody(BaseModel):
    """An error: a stable code, a message that says what to change, and the request's id."""

    model_config = _STRICT
    code: str = Field(..., description="A stable code of the kind of error (SETUP.md and README.md list them).")
    message: str = Field(..., description="What went wrong and what to change, in words.")
    argument: str | None = Field(..., description="The argument the error is about, where one is.")
    allowed: list[str | int] | None = Field(
        ..., description="The values the argument accepts, where they can be listed."
    )
    details: list[ValidationDetail] | None = Field(..., description="For `invalid_request`: every problem found.")
    request_id: str = Field(..., description="The id of the request; quote it when reporting an internal error.")


class ErrorResponse(BaseModel):
    """The body of every response that is not a success."""

    model_config = _STRICT
    error: ErrorBody


class HealthResponse(BaseModel):
    """The server is up and its graphs are loaded."""

    model_config = _STRICT
    status: Literal["ok"] = Field(..., description="Always `ok` (a server that is not ready does not answer).")
    organisms: list[str] = Field(..., description="The organisms whose graphs this server holds.")


class GraphFile(BaseModel):
    """A published file as the server verified it."""

    model_config = _STRICT
    key: str = Field(..., description="The key of the file in the store: `idtrack/<format>/<organism>/<sha256>.npz`.")
    sha256: str = Field(..., description="The SHA-256 of the file's bytes, verified before loading.")
    size: int = Field(..., description="The size of the file in bytes.")


class GraphVersion(BaseModel):
    """What a loaded graph is and what built it."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    snapshot_release: int = Field(..., description="The last Ensembl release of the graph.")
    file: GraphFile
    format_version: int = Field(..., description="The graph file's format version.")
    content_digest: str = Field(..., description="The digest of the graph's content, as its build recorded it.")
    package_version: str | None = Field(..., description="The idtrack version that built the graph.")
    package_commit: str | None = Field(..., description="The idtrack commit that built the graph, where known.")
    build_date: str | None = Field(..., description="When the graph was built.")


class VersionResponse(BaseModel):
    """The versions of the server, of idtrack and of each loaded graph."""

    model_config = _STRICT
    api_version: str = Field(..., description="The version of this api.")
    idtrack_version: str = Field(..., description="The version of idtrack that answers.")
    idtrack_commit: str | None = Field(..., description="The idtrack commit that answers, where known.")
    graph_format_version: int = Field(..., description="The graph file format this idtrack reads.")
    manifest: GraphFile = Field(..., description="The manifest the graphs were read from.")
    graphs: list[GraphVersion] = Field(..., description="The loaded graphs.")


class OrganismsResponse(BaseModel):
    """Every loaded organism and what its graph holds."""

    model_config = _STRICT
    organisms: list[GraphDescriptionModel] = Field(..., description="One description per loaded graph.")  # type: ignore[valid-type]


class FinalDatabasesResponse(BaseModel):
    """The databases a conversion to a release can end in."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    to_release: int = Field(..., description="The target release.")
    final_databases: list[str] = Field(..., description="The values `final_database` accepts for this release.")


class BatchResponse(BaseModel):
    """The results of a batch, one per identifier, in the order given."""

    model_config = _STRICT
    count: int = Field(..., description="The number of results (the number of identifiers given).")
    results: list[ConversionResultModel] = Field(..., description="One result per identifier, in input order.")  # type: ignore[valid-type]


class NamesResponse(BaseModel):
    """Names and the genes they name, per database and release."""

    model_config = _STRICT
    matches: list[NameMatchModel] = Field(..., description="The matches, as idtrack orders them.")  # type: ignore[valid-type]


class Term(BaseModel):
    """A code of the api's answers and what it means, from the one place that defines it."""

    model_config = _STRICT
    code: str = Field(..., description="The code, as answers carry it.")
    meaning: str | None = Field(
        ..., description="What it means, in the defining table's words; `null` where that table gives no text."
    )
    source: Literal["idtrack", "idtrack-web"] = Field(
        ...,
        description=(
            "Whose words `meaning` is: `idtrack` (its own table, `idtrack.results`), or `idtrack-web` (the api's own "
            "table, kept where idtrack gives no text, and tested against idtrack's set of codes)."
        ),
    )


class CriterionField(BaseModel):
    """A `Candidate` field a criterion compares, and which of its values ranks first."""

    model_config = _STRICT
    field: str = Field(..., description="The `Candidate` field.")
    first: Literal["yes", "lower", "higher"] = Field(
        ...,
        description=(
            "Which value ranks first: `yes` (true before false), `lower` or `higher` (a tuple compared part by part, "
            "from its first part)."
        ),
    )
    parts: list[str] | None = Field(
        ...,
        description=(
            "For a field that is a tuple, the names of its parts, each the negated count (as idtrack's text of the "
            "field states); `null` otherwise."
        ),
    )


class CriterionTerm(BaseModel):
    """A criterion that ranks candidates: idtrack's text of its field, and the fields its ranking compares."""

    model_config = _STRICT
    code: str = Field(..., description="The criterion, as `ConversionResult.decided_by` names it.")
    meaning: str | None = Field(..., description="idtrack's text of the `Candidate` field of the same name.")
    source: Literal["idtrack"] = Field(..., description="Whose words `meaning` is (idtrack's).")
    fields: list[CriterionField] = Field(
        ...,
        description=(
            "The fields idtrack's ranking compares for this criterion, in order, the first that differs deciding "
            "(the api's reading of `idtrack.engine.ranking`, which gives no such table; tested against idtrack's "
            "criteria)."
        ),
    )


class BridgeRuleTerm(BaseModel):
    """A rule that takes or refuses a bridge (`BridgeCheck.through`), with idtrack's text."""

    model_config = _STRICT
    code: str = Field(..., description="The rule, as `BridgeCheck.through` carries it.")
    meaning: str | None = Field(..., description="idtrack's text of the rule (`idtrack.results.BRIDGE_RULES`).")
    source: Literal["idtrack"] = Field(..., description="Whose words `meaning` is (idtrack's).")
    taken: bool = Field(..., description="A bridge is taken under this rule (`idtrack.results.BRIDGE_RULES_TAKEN`).")


class ErrorTerm(BaseModel):
    """An error code of the api, its status and when it is answered."""

    model_config = _STRICT
    code: str = Field(..., description="The code, as `error.code` carries it.")
    status: int = Field(..., description="The HTTP status it is answered with.")
    meaning: str = Field(..., description="When it is answered, and what to change.")


class VocabularyResponse(BaseModel):
    """What the codes of the answers mean: idtrack's own tables, and the api's tables where idtrack gives no text.

    Every code is idtrack's (``idtrack.results``: ``STATUSES``, ``REASONS``, ``STEP_REASONS``, ``CRITERIA``,
    ``MATCH_STEPS``, ``MATCH_PREFIXES``, ``READING_REASONS``, ``PLACE_RELATIONS``, ``BRIDGE_RULES``), with idtrack's
    text wherever it gives one; a criterion's meaning is idtrack's text of the ``Candidate`` field it compares. Where
    idtrack gives codes without texts (``STATUSES``) the meaning is the api's (``source`` says so), and the fields a
    criterion compares are the api's reading of idtrack's ranking; both are tested against idtrack's codes.
    """

    model_config = _STRICT
    statuses: list[Term] = Field(..., description="The values of `ConversionResult.status`, in idtrack's order.")
    reasons: list[Term] = Field(..., description="The values of `ConversionResult.reasons` (idtrack's `REASONS`).")
    step_reasons: list[Term] = Field(..., description="The values of `PathStep.reason` (idtrack's `STEP_REASONS`).")
    criteria: list[CriterionTerm] = Field(
        ...,
        description=(
            "The values of `ConversionResult.decided_by`, in the order in which they decide (idtrack's `CRITERIA`); "
            "each criterion is the `Candidate` field of the same name, and its meaning is that field's text."
        ),
    )
    candidate_fields: list[Term] = Field(
        ..., description="Every field of `Candidate`, in order, with idtrack's text of it (its ranking record)."
    )
    match_steps: list[Term] = Field(
        ..., description="The last part of `ConversionResult.match` and `OtherReading.match` (idtrack's `MATCH_STEPS`)."
    )
    match_prefixes: list[Term] = Field(
        ...,
        description=(
            "The parts of a match before its step, each followed by `:`, in this order (idtrack's `MATCH_PREFIXES`)."
        ),
    )
    reading_reasons: list[Term] = Field(
        ..., description="The values of `OtherReading.reason` (idtrack's `READING_REASONS`)."
    )
    place_relations: list[Term] = Field(
        ..., description="The values of `BridgeCheck.places` and `PathStep.places` (idtrack's `PLACE_RELATIONS`)."
    )
    bridge_rules: list[BridgeRuleTerm] = Field(
        ..., description="The rules of `BridgeCheck.through` (idtrack's `BRIDGE_RULES`)."
    )
    errors: list[ErrorTerm] = Field(..., description="The api's error codes (`error.code`).")


class LimitsResponse(BaseModel):
    """The bounds this server enforces, as configured (SETUP.md, "Configuration")."""

    model_config = _STRICT
    batch_max: int = Field(..., description="The most identifiers of one batch.")
    identifier_max_length: int = Field(..., description="The longest identifier or name, in characters.")
    body_max_bytes: int = Field(..., description="The largest request body, in bytes.")
    response_max_bytes: int = Field(
        ..., description="The largest answer, in bytes; a larger one is refused, never cut."
    )
    request_seconds: float = Field(..., description="The time budget of one request, in seconds.")
    search_seconds: float = Field(..., description="The time budget of one identifier's search, in seconds.")
    search_states: int = Field(..., description="The most search states one identifier's search may expand.")
    rate_per_minute: int = Field(..., description="Requests per minute per client (0: no limit).")
    rate_burst: int = Field(..., description="Requests a client may make at once before the rate applies.")
    queue_max: int = Field(..., description="Requests one worker holds, running or waiting, before answering `503`.")


class BatchRequest(BaseModel):
    """A batch of identifiers converted with the same arguments."""

    model_config = ConfigDict(extra="forbid", strict=True)
    identifiers: list[str] = Field(..., min_length=1, description="The identifiers (a bounded number; see `413`).")
    from_release: int | None = Field(None, description="The release the identifiers are read at; `null`: inferred.")
    to_release: int | None = Field(None, description="The target release; `null`: the graph's snapshot release.")
    final_database: str | None = Field(None, description="The database of the targets; `null`: `ensembl_gene`.")
    from_database: str | None = Field(None, description="The database the identifiers are meant in; `null`: any.")
    explain: bool = Field(False, description="Add the path of every candidate.")
    allow_bridges: bool = Field(True, description="Allow bridges through ids two genes share when history ends.")


__all__ = [
    "BatchRequest",
    "BatchResponse",
    "BridgeRuleTerm",
    "ConversionResultModel",
    "CriterionField",
    "CriterionTerm",
    "ErrorBody",
    "ErrorResponse",
    "ErrorTerm",
    "FinalDatabasesResponse",
    "GraphDescriptionModel",
    "GraphFile",
    "GraphVersion",
    "HealthResponse",
    "LimitsResponse",
    "NameMatchModel",
    "NamesResponse",
    "OrganismsResponse",
    "Term",
    "ValidationDetail",
    "VersionResponse",
    "VocabularyResponse",
    "attribute_docs",
    "model_of",
]
