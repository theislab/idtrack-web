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
#: Python's spellings of JSON's literals, as code spans of idtrack's texts write them, and JSON's: the api's answers
#: carry JSON, so its texts name JSON's values.
_JSON_WORDS = {"None": "null", "True": "true", "False": "false"}
_JSON_SPELLING = re.compile(r"`(None|True|False)`")


def plain_text(text: str) -> str:
    """Return docstring text with Sphinx roles and double back quotes as plain Markdown code spans.

    Args:
        text: Docstring text.

    Returns:
        str: The text with ``:py:attr:`~a.b``` as ```b``` (the last part where the docstring asks for it with ``~``,
        else the whole name), double back quotes as single ones, and Python's ``None``, ``True`` and ``False`` in
        code spans as JSON's ``null``, ``true`` and ``false``.
    """

    def role(match: re.Match[str]) -> str:
        name = match.group(1)
        return f"`{name.rsplit('.', 1)[-1]}`" if match.group(0).count("`~") else f"`{name}`"

    text = _LITERAL.sub(r"`\1`", _ROLE.sub(role, text))
    return _JSON_SPELLING.sub(lambda m: f"`{_JSON_WORDS[m.group(1)]}`", text)


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


class CautionAsk(BaseModel):
    """The conversion that answers what a mark doubts: the result's own request, with the parts named changed."""

    model_config = _STRICT
    words: str = Field(..., description='What a link to it says ("Ask TP53 at release 115").')
    identifier: str | None = Field(..., description="The identifier to ask, where `changes` names it.")
    from_release: int | None = Field(..., description="The release to read it at, where `changes` names it.")
    to_release: int | None = Field(..., description="The target release, where `changes` names it.")
    final_database: str | None = Field(
        ..., description="The database to convert to (`null`: Ensembl genes), where `changes` names it."
    )
    from_database: str | None = Field(..., description="The database to read it in, where `changes` names it.")
    changes: list[str] = Field(
        ..., description="The parts of the request this conversion changes; every other part is the result's own."
    )


class Caution(BaseModel):
    """A fact of a result to weigh before trusting its answer: the api's reading of idtrack's fields."""

    model_config = _STRICT
    code: str = Field(..., description="The class of evidence (`cautions` of `GET /vocabulary` gives its meaning).")
    tone: Literal["caution", "note"] = Field(
        ...,
        description=(
            "`caution`: it changes how far the answer can be trusted (review it); `note`: an exact fact about the "
            "answer that is no fault."
        ),
    )
    label: str = Field(..., description="A few words that name it, with the result's values (for a mark on a page).")
    text: str = Field(..., description="What the result says, with its own values.")
    limitation: str | None = Field(
        ...,
        description=(
            "The address of the section of idtrack's documented limitations that describes this class, where there is "
            "one."
        ),
    )
    alert: bool = Field(
        ...,
        description="Another gene than the best answer may be the gene meant (worth saying beside the status itself).",
    )
    ask: CautionAsk | None = Field(..., description="The conversion that answers what the mark doubts, where one does.")
    read_at: int | None = Field(
        ..., description="A release at which the identifier means what this mark says (another meaning's last release)."
    )


#: The fields the api adds to idtrack's results, by result class: the additions to idtrack's ``to_dict()``. A batch
#: item's error carries the api's stable code of its kind, as the same input sent alone would be answered (the
#: frontend and other programs branch on codes, not on idtrack's class names); a result carries the api's reading of
#: its evidence (:py:mod:`idtrack_web_api.cautions`).
API_FIELDS: dict[str, dict[str, tuple[Any, str]]] = {
    "ConversionResult": {
        "cautions": (
            list[Caution],
            (
                "The api's reading of this result's evidence, by stated rules (`cautions` of `GET /vocabulary`): each "
                "fact of the best answer a reader should weigh before trusting it (`tone` `caution`: review the "
                "answer) or that is worth knowing (`note`), cautions first, with the section of idtrack's documented "
                "limitations it falls under. Read with the path whatever `explain` asks: every rule holds for every "
                "answer. Empty: nothing to weigh. Added by the api to idtrack's result."
            ),
        )
    },
    "ErrorInfo": {
        "code": (
            str,
            (
                "The api's stable code of the error (one of the error codes of `GET /vocabulary`, as the same "
                "identifier sent alone to `/convert` would be answered: `missing_value` for an empty string or a "
                "spelling of a missing value, `search_budget_exceeded` for a search over its budget, `internal_error` "
                "for a fault). Added by the api to idtrack's error record."
            ),
        )
    },
}


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
            msg = f"{cls.__name__}.{f.name} has no text in the docstring of {cls.__name__}."
            raise TypeError(msg)
        definitions[f.name] = (_translate(hints[f.name]), Field(..., description=docs[f.name]))
    for name, (kind, text) in API_FIELDS.get(cls.__name__, {}).items():
        definitions[name] = (kind, Field(..., description=text))
    model: type[BaseModel] = create_model(
        cls.__name__, __config__=_STRICT, __doc__=_summary(cls), __module__=__name__, **definitions
    )
    _MODELS[cls] = model
    return model


ConversionResultModel = model_of(RESULT_CLASSES["ConversionResult"])
GraphDescriptionModel = model_of(RESULT_CLASSES["GraphDescription"])
NameMatchModel = model_of(RESULT_CLASSES["NameMatch"])
SourceInferenceModel = model_of(RESULT_CLASSES["SourceInference"])


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
    code: str = Field(
        ...,
        description=(
            "A stable code of the kind of error: branch on it (its meaning, title and whether to retry: `errors` of "
            "`GET /api/v1/vocabulary`)."
        ),
    )
    message: str = Field(..., description="What went wrong and what to change, in words.")
    argument: str | None = Field(..., description="The argument the error is about, where one is.")
    allowed: list[str | int] | None = Field(
        ..., description="The values the argument accepts, where they can be listed."
    )
    details: list[ValidationDetail] | None = Field(..., description="For `invalid_request`: every problem found.")
    request_id: str = Field(
        ...,
        description=(
            "The id of the request (also the `X-Request-ID` header): the client's own `X-Request-ID` where it sent a "
            "well-formed one, else one the server made; quote it when reporting an internal error."
        ),
    )
    retry_after: int | None = Field(
        default=None,
        description=(
            "For a refusal to retry later (`429`, `503`): the whole seconds to wait, as the `Retry-After` header says; "
            "`null` otherwise."
        ),
    )
    allowance: Literal["searches", "reads", "search_seconds", "concurrent_searches"] | None = Field(
        default=None,
        description=(
            "For `rate_limited`: which of the client's allowances it used up (`/api/v1/limits` gives each); `null` "
            "otherwise."
        ),
    )


class ErrorResponse(BaseModel):
    """The body of every response that is not a success."""

    model_config = _STRICT
    error: ErrorBody = Field(..., description="The error: its code, the message, and what the request got wrong.")


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
    file: GraphFile = Field(..., description="The graph's file as the server verified it (key, SHA-256, size).")
    format_version: int = Field(..., description="The graph file's format version.")
    content_digest: str = Field(..., description="The digest of the graph's content, as its build recorded it.")
    package_version: str | None = Field(
        ...,
        description=(
            "The idtrack version that built the graph, where its build record gives one; `null` where the record "
            "holds a text instead (`package_version_note`)."
        ),
    )
    package_version_note: str | None = Field(
        default=None,
        description=(
            "The build record's own text where it gives no version (for a graph built from a source folder rather "
            "than an installed idtrack); `null` where it gives a version. The graph's description "
            "(`GET /organisms/{organism}`) carries the record as it is."
        ),
    )
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
    docs_url: str = Field(
        ...,
        description=(
            "The address of idtrack's documentation this server links to (its root, ending in `/`; "
            "`IDTRACK_WEB_DOCS_URL`, by default Read the Docs' stable version)."
        ),
    )


class OrganismNames(BaseModel):
    """The names by which the path of the api takes an organism."""

    model_config = _STRICT
    organism: str = Field(..., description="Its Ensembl production name (`homo_sapiens`).")
    aliases: list[str] = Field(
        ...,
        description=(
            "The short names idtrack declares for it (`idtrack.organisms.ALIASES`: `human`). The path also takes the "
            "production name with spaces for underscores and in any letter case (`Homo sapiens`); no other name, and "
            "no taxon id: idtrack resolves names without the network only so."
        ),
    )


class OrganismsResponse(BaseModel):
    """Every loaded organism and what its graph holds."""

    model_config = _STRICT
    organisms: list[GraphDescriptionModel] = Field(..., description="One description per loaded graph.")  # type: ignore[valid-type]
    names: list[OrganismNames] = Field(
        default_factory=list,
        description="The names the path `{organism}` takes for each loaded organism, in the order of `organisms`.",
    )


class FinalDatabasesResponse(BaseModel):
    """The databases a conversion to a release can end in."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    to_release: int = Field(..., description="The target release.")
    final_databases: list[str] = Field(..., description="The values `final_database` accepts for this release.")


class DatabaseReleases(BaseModel):
    """An external database (or one of Ensembl's gene namespaces) and the releases a conversion can end in it."""

    model_config = _STRICT
    name: str = Field(..., description="The database, as `final_database` takes it.")
    form: str | None = Field(
        ...,
        description=(
            "The Ensembl form the database connects through (`gene`, `transcript`, `translation`: idtrack's "
            "`API.database_forms()`); `null` for idtrack's own gene namespaces `ensembl_gene` and `base_ensembl_gene`, "
            "which that table does not list."
        ),
    )
    releases: list[int] = Field(
        ...,
        description=(
            "The releases whose `final_databases` include it (idtrack's `API.final_databases(to_release)`), ascending."
        ),
    )
    kind: Literal["ensembl", "accession", "label"] = Field(
        ...,
        description=(
            "What its values are (`database_kinds` of `GET /vocabulary`): `ensembl`, one of idtrack's two Ensembl gene "
            "namespaces; `label`, a database whose ids are labels (display names, symbols) rather than accessions "
            "(the graph's `label_databases`); `accession`, any other external database."
        ),
    )
    versioned: bool | None = Field(
        ...,
        description=(
            "For `ensembl`: whether its values carry the Ensembl version (`ensembl_gene`: `ENSG00000141510.20`; "
            "`base_ensembl_gene`: `ENSG00000141510`); `null` for an external database."
        ),
    )
    authority: bool = Field(
        ...,
        description=(
            "Whether it is a database of a name authority of the organism (the graph's `authority_databases`: its "
            "symbol databases and NCBI's official symbols)."
        ),
    )
    labels: str | None = Field(
        ...,
        description=(
            "For an `accession` database whose labels the graph holds apart: the database of its labels (the graph's "
            "`label_names`: `EntrezGene`, NCBI's gene numbers, has its official symbols in `NCBI gene (formerly "
            "Entrezgene)`); `null` otherwise."
        ),
    )
    labels_of: list[str] = Field(
        ...,
        description=(
            "For a `label` database: the accession databases whose labels it holds (empty for none, or another kind)."
        ),
    )
    former_names: list[str] = Field(
        ...,
        description=(
            "Names Ensembl gave the database at some release that the graph does not use (the graph's "
            "`renamed_databases`): sent as `final_database` or `from_database`, such a name is refused with the "
            "graph's name in the message."
        ),
    )


class DatabasesResponse(BaseModel):
    """What a conversion to each release of a graph can end in: a release-by-database matrix, and per assembly."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    releases: list[int] = Field(..., description="Every release of the graph, ascending: the matrix's columns.")
    databases: list[DatabaseReleases] = Field(
        ...,
        description=(
            "Every database a conversion to some release can end in, sorted by name: the matrix's rows. The cell of "
            "a release and a database is set when the release is in the database's `releases`."
        ),
    )
    by_assembly: dict[str, list[str]] = Field(
        ...,
        description=(
            "The external databases of each genome assembly of the graph (idtrack's `API.databases_by_assembly()`; "
            "an assembly by its number, as a string). A release's databases are those of the assembly that serves it "
            "(`assemblies[].serves` of `/organisms/{organism}`) and the two gene namespaces."
        ),
    )
    symbol_databases: list[str] = Field(
        ...,
        description=(
            "The organism's symbol databases, its name authorities, in idtrack's order "
            "(`idtrack.organisms.SYMBOL_DATABASES`): the first one a conversion to a release can end in is the one "
            "idtrack's harmonization uses by default there."
        ),
    )


class BatchArguments(BaseModel):
    """The arguments of a batch as the api read them (`null`: not given, the default applies)."""

    model_config = _STRICT
    from_release: int | None = Field(..., description="`from_release` of the body.")
    to_release: int | None = Field(
        ..., description="`to_release` of the body (each result's `to_release` is the one used)."
    )
    final_database: str | None = Field(..., description="`final_database` of the body.")
    from_database: str | None = Field(..., description="`from_database` of the body.")
    explain: bool = Field(..., description="`explain` of the body.")
    allow_bridges: bool = Field(..., description="`allow_bridges` of the body.")
    read_copies: bool = Field(..., description="`read_copies` of the body.")


class BatchResponse(BaseModel):
    """The results of a batch, one per identifier, in the order given, with the organism and the arguments read."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism whose graph answered.")
    arguments: BatchArguments = Field(..., description="The arguments of the batch, as read (its identifiers aside).")
    count: int = Field(..., description="The number of results (the number of identifiers given).")
    results: list[ConversionResultModel] = Field(..., description="One result per identifier, in input order.")  # type: ignore[valid-type]


class GenesNamedArguments(BaseModel):
    """The arguments of `genes-named` as the api read them."""

    model_config = _STRICT
    name: str = Field(..., description="The name, as sent.")
    fold_case: bool = Field(..., description="Whether letter case was ignored.")
    release: int | None = Field(..., description="The release the matches hold at; `null`: every match.")


class NamesOfArguments(BaseModel):
    """The arguments of `names-of` as the api read them."""

    model_config = _STRICT
    gene: str = Field(..., description="The gene, as sent.")
    release: int | None = Field(..., description="The release the names hold at; `null`: every release.")


class NamesResponse(BaseModel):
    """Names and the genes they name, per database and release, with the organism and the arguments read."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism whose graph answered.")
    arguments: GenesNamedArguments | NamesOfArguments = Field(
        ...,
        description=(
            "The arguments as read: `name`, `fold_case`, `release` (genes-named); `gene`, `release` (names-of)."
        ),
    )
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
            "Whose words `meaning` is: `idtrack` (its own table of the codes), or `idtrack-web` (the api's own table, "
            "kept where idtrack gives no text, and tested against idtrack's set of codes)."
        ),
    )


class StatusTerm(Term):
    """A status of a conversion, what it means, and whether its best candidates answer in the database asked."""

    answers_requested_database: bool = Field(
        ...,
        description=(
            "Whether the best candidates of a result with this status hold answers in the database asked "
            "(`final_database` as requested): `true` for `converted` and `tie`; for `no_target` the candidates are "
            "genes standing in for the missing id (`final_database` is then `ensembl_gene`), and the other statuses "
            "have no best candidate."
        ),
    )


class CautionTerm(BaseModel):
    """A class of evidence of the cautions, its tone and meaning, and the limitation it falls under."""

    model_config = _STRICT
    code: str = Field(..., description="The code, as `cautions[].code` carries it.")
    tone: Literal["caution", "note"] = Field(..., description="`caution` (review the answer) or `note`.")
    meaning: str = Field(..., description="What it means, in the api's words.")
    reads_path: bool = Field(..., description="Whether its rule reads the path (its steps, nodes or bridges).")
    limitation: str | None = Field(
        ..., description="The address of the section of idtrack's documented limitations of this class, if any."
    )
    source: Literal["idtrack-web"] = Field(..., description="The api's own table (`api/idtrack_web_api/cautions.py`).")


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
            "(the api's reading of idtrack's ranking, which gives no such table; tested against idtrack's criteria)."
        ),
    )


class BridgeRuleTerm(BaseModel):
    """A rule that takes or refuses a bridge (`BridgeCheck.through`), with idtrack's text."""

    model_config = _STRICT
    code: str = Field(..., description="The rule, as `BridgeCheck.through` carries it.")
    meaning: str | None = Field(..., description="idtrack's text of the rule.")
    source: Literal["idtrack"] = Field(..., description="Whose words `meaning` is (idtrack's).")
    taken: bool = Field(..., description="`true`: a bridge is taken under this rule; `false`: refused.")


class ErrorTerm(BaseModel):
    """An error code of the api, its status and when it is answered."""

    model_config = _STRICT
    code: str = Field(..., description="The code, as `error.code` carries it.")
    status: int = Field(..., description="The HTTP status it is answered with.")
    title: str = Field(
        ..., description="A few plain words for the heading of the refusal shown to a person (no code, no header name)."
    )
    meaning: str = Field(..., description="When it is answered, and what to change.")
    retryable: bool = Field(
        ...,
        description=(
            "`true`: the same request may succeed when sent again (after the `Retry-After` header's seconds where it "
            "is given); `false`: the same request gets the same answer until it is changed."
        ),
    )
    source: Literal["idtrack-web"] = Field(
        default="idtrack-web", description="Whose words `title` and `meaning` are: the api's (its own codes)."
    )


class VocabularyResponse(BaseModel):
    """What the codes of the answers mean: idtrack's own tables, and the api's tables where idtrack gives no text.

    Every code is idtrack's, with idtrack's text wherever it gives one; a criterion's meaning is idtrack's text of the
    `Candidate` field it compares. Where idtrack gives codes without texts (the statuses) the meaning is the api's
    (`source` says so), and the fields a criterion compares are the api's reading of idtrack's ranking; both are tested
    against idtrack's codes. The same codes are the enumerations of the OpenAPI document.
    """

    model_config = _STRICT
    statuses: list[StatusTerm] = Field(..., description="The values of `ConversionResult.status`, in idtrack's order.")
    reasons: list[Term] = Field(..., description="The values of `ConversionResult.reasons` and `reason`.")
    step_reasons: list[Term] = Field(..., description="The values of `PathStep.reason`.")
    criteria: list[CriterionTerm] = Field(
        ...,
        description=(
            "The values of `ConversionResult.decided_by`, in the order in which they decide; each criterion is the "
            "`Candidate` field of the same name, and its meaning is that field's text."
        ),
    )
    candidate_fields: list[Term] = Field(
        ..., description="Every field of `Candidate`, in order, with idtrack's text of it (its ranking record)."
    )
    match_steps: list[Term] = Field(
        ..., description="The last part of `ConversionResult.match` and `OtherReading.match`."
    )
    match_prefixes: list[Term] = Field(
        ...,
        description="The parts of a match before its step, each followed by `:`, in this order.",
    )
    reading_reasons: list[Term] = Field(..., description="The values of `OtherReading.reason`.")
    place_relations: list[Term] = Field(..., description="The values of `BridgeCheck.places` and `PathStep.places`.")
    bridge_rules: list[BridgeRuleTerm] = Field(..., description="The rules of `BridgeCheck.through`.")
    errors: list[ErrorTerm] = Field(..., description="The api's error codes (`error.code`), with their HTTP status.")
    database_kinds: list[Term] = Field(
        default_factory=list,
        description="The values of `kind` of a database of `GET /organisms/{organism}/databases`.",
    )
    allowances: list[Term] = Field(
        default_factory=list, description="The values of `allowance` of a `429 rate_limited` refusal."
    )
    source_modes: list[Term] = Field(
        default_factory=list,
        description="The values of `mode` of `POST /organisms/{organism}/source-inference`: what an origin is.",
    )
    cautions: list[CautionTerm] = Field(
        default_factory=list,
        description="The classes of evidence a result's `cautions` name: the api's reading of idtrack's fields.",
    )


class LimitsResponse(BaseModel):
    """The bounds this server enforces, as configured (SETUP.md, "Configuration")."""

    model_config = _STRICT
    batch_max: int = Field(..., description="The most identifiers of one batch.")
    identifier_max_length: int = Field(..., description="The longest identifier or name, in characters.")
    body_max_bytes: int = Field(..., description="The largest request body, in bytes.")
    response_max_bytes: int = Field(
        ..., description="The largest answer, in bytes; a larger one is refused, never cut."
    )
    request_seconds: float = Field(
        ...,
        description=(
            "The time budget of one request's search, in seconds, from when its search begins (a batch: all its "
            "identifiers); a batch out of it is refused `503 request_budget_exceeded`, with the count it converted."
        ),
    )
    queue_seconds: float = Field(
        ...,
        description=(
            "The longest a search waits for a worker free of searches, in seconds: a search still waiting then is "
            "answered `503 server_busy` without being searched, and one whose wait, estimated from the searches "
            "waiting before it and the recent searches' mean time, would pass it is answered so at once."
        ),
    )
    search_seconds: float = Field(..., description="The time budget of one identifier's search, in seconds.")
    search_states: int = Field(..., description="The most search states one identifier's search may expand.")
    rate_per_minute: int = Field(
        ...,
        description=(
            "Searching requests (conversions, batches, names) per minute per client; `0`: no per-client allowance of "
            "any kind. A client is its address, an IPv6 address by its `/64`."
        ),
    )
    rate_burst: int = Field(..., description="Searching requests a client may make at once before the rate applies.")
    read_share: int = Field(
        ...,
        description=(
            "Every other request of the api (the tables and documents answered from memory, an answer sent again from "
            "the server's memory, a `304`) draws on an allowance this many times `rate_per_minute` and `rate_burst`; "
            "`/health` on none."
        ),
    )
    rate_search_seconds: float = Field(
        ...,
        description=(
            "Seconds of search per minute per client: each search's own time (with writing and compressing its "
            "answer) is charged when its answer is written, and a client whose balance is below zero is answered `429` "
            "until it is back to zero; `0`: not limited."
        ),
    )
    rate_search_burst_seconds: float = Field(..., description="The most seconds of search a client's balance holds.")
    queue_max: int = Field(
        ...,
        description=(
            "Searches that may wait for a worker, per worker: when every worker is in a search and `queue_max` times "
            "the workers wait, a search is answered `503 server_busy`."
        ),
    )
    head_seconds: float = Field(
        ..., description="The longest a connection may take to send its request's head; it is closed after."
    )
    body_seconds: float = Field(
        ..., description="The longest a request's body may take to arrive (`408 request_timeout` after)."
    )
    answer_cache_bytes: int = Field(
        ...,
        description=(
            "The answers each worker keeps to send again without a search (GETs, by `ETag`), in bytes; `0`: none."
        ),
    )
    allowances_enforced: bool = Field(
        default=False,
        description=(
            "Whether the per-client allowances apply on this server (`rate_per_minute` above 0). When `false`, the "
            "bounds `allowance_fields` names are configured but not applied, and no answer is `429`; every other "
            "bound applies on every server."
        ),
    )
    allowance_fields: list[str] = Field(
        default_factory=list,
        description=(
            "The fields of this answer that are per-client allowances (applied only where `allowances_enforced` is "
            "`true`), in this answer's order; every other field is a bound of the server as a whole, always applied."
        ),
    )
    rate_concurrent_searches: int = Field(
        default=0,
        description=(
            "Searching requests a client may have in progress at once, from their admission until their answer is "
            "sent; more are answered `429` (`allowance` `concurrent_searches`) at once; `0`: not limited."
        ),
    )
    send_seconds: float = Field(
        default=0.0,
        description=(
            "The longest a client may leave an answer untaken (reading none of it) before its connection is closed."
        ),
    )
    send_min_bytes_per_second: int = Field(
        default=0,
        description=(
            "The slowest a client may take an answer, in bytes per second on average, once `send_seconds` have passed "
            "since its answer began; a slower client has its connection closed."
        ),
    )
    sending_max_bytes: int = Field(
        default=0,
        description=(
            "The most bytes of answers one worker holds for clients that have not taken them yet; an answer beyond "
            "is refused with `503 server_busy`."
        ),
    )


class ProcessLoad(BaseModel):
    """One process of the server (the master, or a worker): its CPU and memory as last sampled."""

    model_config = _STRICT
    started_at: str = Field(
        ...,
        description=(
            "When it began serving (UTC, ISO 8601): for the master, when the graphs were loaded; for a worker, its "
            "first request or sample after the fork."
        ),
    )
    cpu_share: float | None = Field(
        ...,
        description=(
            "The share of one core it used over the last sampling interval: CPU time (user and system, all threads) "
            "over wall time between two samples; `1.0` is one core kept busy, and a process with several busy threads "
            "can exceed it. `null` until two samples exist, or where it cannot be measured."
        ),
    )
    cpu_seconds: float | None = Field(..., description="The CPU time it has used since it started, in seconds.")
    rss_bytes: int | None = Field(
        ...,
        description=(
            "Resident set size: its pages in memory. A page the workers share with the master (the graphs, loaded "
            "before the fork) is counted in full in every process that maps it, so the RSS of the processes do not "
            "add up to the server's footprint."
        ),
    )
    pss_bytes: int | None = Field(
        ...,
        description=(
            "Proportional set size: its resident pages, each shared page divided by the number of processes sharing "
            "it. The sum over the server's processes is the server's real footprint."
        ),
    )
    uss_bytes: int | None = Field(
        ..., description="Unique set size: its pages no other process maps (what it would free on exit)."
    )
    cpu_sample_age_seconds: float | None = Field(
        ..., description="Seconds between its last sample of CPU and this answer; `null` if it was never sampled."
    )
    memory_sample_age_seconds: float | None = Field(
        ..., description="Seconds between its last sample of memory and this answer; `null` if it was never sampled."
    )


class WorkerLoad(ProcessLoad):
    """One worker: its CPU and memory, and the requests it holds and has answered."""

    worker: int = Field(
        ...,
        description=(
            "The worker's row in the server's table, from 1 (a worker that replaces one that ended may take its row); "
            "process ids are not published."
        ),
    )
    requests: int = Field(..., description="Requests it answered since it began (requests to `/status` not counted).")
    in_flight: int = Field(..., description="Requests it holds now: arrived and not yet answered.")
    searches_running: int = Field(..., description="Searches its search thread runs now (0 or 1).")
    searches_waiting: int = Field(..., description="Requests waiting for its search thread.")
    sending_bytes: int | None = Field(
        default=None, description="Bytes of answers it holds for clients that have not taken them yet."
    )
    last_60_seconds: int = Field(
        ..., description="Requests it answered in the last 60 seconds (counted per whole second)."
    )
    errors_4xx: int = Field(..., description="Requests it answered with a status of 400 to 499.")
    errors_5xx: int = Field(..., description="Requests it answered with a status of 500 or more.")


class CpuLoad(BaseModel):
    """The server's CPU use against the cores available to it."""

    model_config = _STRICT
    cores_used: float | None = Field(
        ...,
        description=(
            "The sum of `cpu_share` over the master and the workers: cores kept busy over the last interval. `null` "
            "when a process's share is unknown."
        ),
    )
    share_of_available: float | None = Field(
        ..., description="`cores_used` over `cores_available`: `1.0` is every available core busy."
    )
    cores_available: float = Field(
        ..., description="The cores the server may use: the smaller of `affinity_cores` and `quota_cores`."
    )
    affinity_cores: int = Field(
        ...,
        description="The CPUs the processes may run on (their CPU affinity set; off Linux, the machine's CPU count).",
    )
    quota_cores: float | None = Field(
        ...,
        description=(
            "A cgroup v2 `cpu.max` quota in cores (quota over period), the smallest of the server's cgroup and its "
            "ancestors (a container's limit); `null` when none is set."
        ),
    )
    source: Literal["cgroup", "affinity", "cpu_count"] = Field(
        ...,
        description="What sets `cores_available`: the cgroup quota, the affinity set, or the machine's CPU count.",
    )


class MemoryLoad(BaseModel):
    """The server's memory: its processes summed, and the limit it runs under."""

    model_config = _STRICT
    pss_bytes: int | None = Field(
        ...,
        description=(
            "The sum of PSS over the master and the workers: the server's real footprint (each shared page counted "
            "once in all)."
        ),
    )
    rss_bytes: int | None = Field(
        ...,
        description=(
            "The sum of RSS over the processes: shared pages counted once per process, so more than the footprint "
            "when workers share the graphs."
        ),
    )
    uss_bytes: int | None = Field(..., description="The sum of USS: the pages that belong to one process alone.")
    limit_bytes: int | None = Field(
        ...,
        description=(
            "The memory the server runs under: the smallest cgroup v2 `memory.max` of its cgroup and its ancestors "
            "(`source` `cgroup`), else the machine's total memory (`source` `meminfo`)."
        ),
    )
    limit_used_bytes: int | None = Field(
        ...,
        description=(
            "What is used of that limit: the limiting cgroup's `memory.current` (every process in it, page cache "
            "included), or the machine's total less its available memory."
        ),
    )
    source: Literal["cgroup", "meminfo"] | None = Field(
        ..., description="Where the limit comes from; `null` when neither can be read."
    )


class LatencyLoad(BaseModel):
    """How long the server's recent requests took, from arrival to the last byte sent."""

    model_config = _STRICT
    count: int = Field(..., description="The requests the percentiles are over.")
    most_recent: int = Field(
        ..., description="The percentiles are over at most this many of the most recent requests..."
    )
    window_seconds: float = Field(..., description="...that ended within this many seconds before the sample.")
    p50_ms: float | None = Field(..., description="The median, in milliseconds (nearest rank); `null` with no request.")
    p95_ms: float | None = Field(..., description="The 95th percentile, in milliseconds (nearest rank).")
    p99_ms: float | None = Field(..., description="The 99th percentile, in milliseconds (nearest rank).")
    max_ms: float | None = Field(..., description="The longest, in milliseconds.")


class RequestsLoad(BaseModel):
    """The server's requests, over every worker (requests to `/status` are counted apart, in `status_requests`)."""

    model_config = _STRICT
    total: int = Field(
        ..., description="Requests answered since the server started, by every worker, replaced ones included."
    )
    in_flight: int = Field(..., description="Requests held now by the live workers.")
    searches_running: int = Field(..., description="Searches running now (at most one per worker).")
    searches_waiting: int = Field(
        ...,
        description=(
            "Searches a worker holds that wait for its own search thread (behind the search it runs). The three counts "
            "of waiting requests (this, `searches_queued` and `connections_waiting`) never hold the same request "
            "twice: their sum is every request waiting."
        ),
    )
    connections_waiting: int | None = Field(
        ...,
        description=(
            "Connections in the kernel's listen queue that no worker has taken yet (the kernel's count); `null`: not "
            "read, as when the app runs without the server."
        ),
    )
    searches_queued: int | None = Field(
        default=None,
        description=(
            "Searches waiting in the queue the workers share for a worker free of searches (every worker is in one); "
            "`null` when the app runs without the server."
        ),
    )
    sending_bytes: int | None = Field(
        default=None,
        description=(
            "Bytes of answers the live workers hold for clients that have not taken them yet (bounded per worker by "
            "`sending_max_bytes` of `GET /limits`)."
        ),
    )
    last_60_seconds: int = Field(
        ..., description="Requests answered in the last 60 seconds (counted per whole second)."
    )
    errors_4xx: int = Field(..., description="Requests answered with a status of 400 to 499 since the server started.")
    errors_5xx: int = Field(..., description="Requests answered with a status of 500 or more since the server started.")
    lost: int = Field(
        ...,
        description=(
            "Requests a worker held when it ended without giving back its row (killed by the master's timeout, the "
            "kernel's out-of-memory killer or a signal): their clients got no answer."
        ),
    )
    status_requests: int = Field(
        ..., description="Requests to `/status` since the server started (counted apart from every count above)."
    )
    latency: LatencyLoad = Field(
        ..., description="The latency of the server's most recent requests (`/status` not counted), in milliseconds."
    )


class GraphLoad(BaseModel):
    """A graph the server holds in memory."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    file_bytes: int = Field(..., description="The size of its graph file.")


class StatusResponse(BaseModel):
    """The server's load: every worker and the master, measured by the server (see README, "The server's load").

    Each worker keeps its facts in memory shared by the server's processes and samples its own CPU every
    `sample_interval_seconds` and its memory every `memory_sample_interval_seconds`; any worker reads them all to
    answer. What cannot be measured here is `null` and named in `unavailable`.
    """

    model_config = _STRICT
    sampled_at: str = Field(..., description="When this answer was made (UTC, ISO 8601).")
    started_at: str = Field(..., description="When the server had loaded its graphs and began (UTC, ISO 8601).")
    uptime_seconds: float = Field(..., description="Seconds since `started_at`.")
    sample_interval_seconds: float = Field(..., description="Seconds between two samples of a process's CPU.")
    memory_sample_interval_seconds: float = Field(
        ...,
        description=(
            "Seconds between two samples of a process's memory (reading PSS makes the kernel walk the process's page "
            "tables, so memory is sampled less often than CPU)."
        ),
    )
    cache_seconds: float = Field(
        ..., description="An answer is reused for this long by the worker that made it (polling stays cheap)."
    )
    workers_configured: int = Field(..., description="The workers the server is configured to run.")
    workers_alive: int = Field(..., description="The workers running now.")
    workers_exited: int = Field(
        ...,
        description=(
            "Workers that ended since the server started, each replaced by the master (a reload ends every worker; a "
            "worker that was killed also adds its requests to `requests.lost`)."
        ),
    )
    last_worker_exit_at: str | None = Field(
        ..., description="When the last worker ended (UTC, ISO 8601); `null` if none has."
    )
    master: ProcessLoad | None = Field(
        ...,
        description=(
            "The master process that loaded the graphs and forked the workers; `null` when the application runs in a "
            "single process (no master)."
        ),
    )
    workers: list[WorkerLoad] = Field(..., description="The live workers, by their row.")
    cpu: CpuLoad = Field(..., description="The cores the server's processes use, and the cores available to it.")
    memory: MemoryLoad = Field(..., description="The memory of the server's processes, and the limit it runs under.")
    requests: RequestsLoad = Field(
        ..., description="The requests of every worker: answered, in progress, searching, waiting, failed, by latency."
    )
    graphs: list[GraphLoad] = Field(..., description="The graphs loaded, in the manifest's order.")
    graphs_file_bytes: int = Field(..., description="The sizes of the graph files, summed.")
    unavailable: list[str] = Field(
        ...,
        description=(
            "The fields that could not be measured on this server (each `null` above), by their place in the answer "
            "(`master.pss_bytes`, `memory.limit_bytes`, ...); empty when everything was measured."
        ),
    )


class IndexEndpoint(BaseModel):
    """One endpoint of the api."""

    model_config = _STRICT
    method: str = Field(..., description="The HTTP method (a `GET` endpoint also takes `HEAD`).")
    path: str = Field(..., description="The path, `{organism}` for the organism's name.")
    operation_id: str = Field(..., description="Its `operationId` in the OpenAPI document.")
    summary: str = Field(..., description="What it answers.")


class IndexResponse(BaseModel):
    """Where everything is: the api's documents and every endpoint."""

    model_config = _STRICT
    api_version: str = Field(..., description="The version of this api.")
    openapi: str = Field(..., description="The OpenAPI document: every endpoint, parameter, field, code and example.")
    llms_txt: str = Field(..., description="The index for language models (the llms.txt convention).")
    llms_full_txt: str = Field(..., description="Every rule, code and example of the api as one Markdown text.")
    reference: str | None = Field(
        ..., description="The reference for people, with a console per endpoint; `null` where no page is served."
    )
    vocabulary: str = Field(..., description="The meanings of every code (`GET`).")
    limits: str = Field(..., description="The bounds this server enforces (`GET`).")
    organisms: str = Field(..., description="The organisms this server holds (`GET`).")
    endpoints: list[IndexEndpoint] = Field(..., description="Every endpoint, in the document's order.")


class ShowcaseQuery(BaseModel):
    """A conversion as `GET .../convert` takes it (`explain` always `true`)."""

    model_config = _STRICT
    identifier: str = Field(..., description="The identifier.")
    from_release: int | None = Field(..., description="The release it is read at; `null`: inferred.")
    to_release: int | None = Field(..., description="The target release; `null`: the snapshot release.")
    final_database: str | None = Field(..., description="The database of the targets; `null`: `ensembl_gene`.")
    explain: bool = Field(..., description="Always `true`: every result holds its paths.")


class ShowcaseItem(BaseModel):
    """A chosen conversion and its answer."""

    model_config = _STRICT
    query: ShowcaseQuery = Field(..., description="The conversion as `GET .../convert` takes it.")
    result: ConversionResultModel | None = Field(  # type: ignore[valid-type]
        ..., description="The answer, exactly as `GET .../convert` gives it; `null` when the request was refused."
    )
    error: ErrorBody | None = Field(
        ...,
        description="The refusal (as `GET .../convert` would answer it), with `request_id` `showcase`; else `null`.",
    )


class ShowcaseCase(ShowcaseItem):
    """A chosen conversion that shows one phenomenon of Ensembl's history."""

    kind: str = Field(
        ...,
        description=(
            "The phenomenon its answer shows, read from the answer's own fields: `new_version`, `replaced`, `merge` "
            "or `final` (the best candidate's path takes a step of that reason), `renamed` (a step `final`, the "
            "identifier read in the database it is answered in, and no best target the identifier itself), `split` "
            "(a step `split` or `split_and_merge`), `handoff` (a history step between two assemblies), `bridge` "
            "(steps `bridge_near` and `bridge_far`), `other_release` (an other reading of reason `other_release`), "
            "`tie` (status `tie`), `retired` (status `no_conversion` with the reason `no_path_to_target`), `refused` "
            "(a refused step of reason `mitochondrial_genome` in `path.refused`), `lineage` (the best candidate's "
            "path holds steps on every assembly of the graph)."
        ),
    )


class ShowcaseResponse(BaseModel):
    """Chosen conversions of one graph, answered once when the server started (the home page's figures)."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    content_digest: str | None = Field(..., description="The digest of the graph's content that answered.")
    checked_on: str | None = Field(
        ...,
        description=(
            "The content digest of the graph the cases were checked on (each case's answer shows its kind there); the "
            "cases are given only when it is `content_digest`; `null`: no cases chosen for this organism."
        ),
    )
    journeys: list[ShowcaseItem] = Field(..., description="Conversions that show the kinds of journey, in order.")
    cases: list[ShowcaseCase] = Field(..., description="Conversions that show phenomena of Ensembl's history.")


class ShowcaseQueryItem(BaseModel):
    """A chosen conversion of the showcase, without its answer."""

    model_config = _STRICT
    query: ShowcaseQuery = Field(..., description="The conversion as `GET .../convert` takes it.")


class ShowcaseQueryCase(ShowcaseQueryItem):
    """A chosen conversion that shows one phenomenon of Ensembl's history, without its answer."""

    kind: str = Field(..., description="The phenomenon its answer shows (`kind` of `GET .../showcase`'s cases).")


class ShowcaseQueriesResponse(BaseModel):
    """The showcase's chosen conversions without their answers (``GET .../showcase`` holds them with their answers)."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    content_digest: str | None = Field(..., description="The digest of the graph's content.")
    checked_on: str | None = Field(..., description="As `checked_on` of `GET .../showcase`.")
    journeys: list[ShowcaseQueryItem] = Field(..., description="The journeys' queries, in order.")
    cases: list[ShowcaseQueryCase] = Field(..., description="The cases' queries and kinds, in order.")


class HistoryRelease(BaseModel):
    """One release of the graph: the gene ids active and those created."""

    model_config = _STRICT
    release: int = Field(..., description="The Ensembl release.")
    genes_active: int = Field(
        ...,
        description=(
            "Stable gene ids of the graph's history with a version active at the release (idtrack's "
            "`TheGraph.active_releases` of each version; every assembly and region the graph holds, alternative loci "
            "included)."
        ),
    )
    versions_active: int = Field(..., description="Gene versions (`<id>.<version>`) active at the release.")
    created: int = Field(
        ...,
        description=(
            "History edges from Ensembl's creation marker of an id (`<id>.Void`) to its first version at this "
            "release: ids that begin here."
        ),
    )


class HistoryTransition(BaseModel):
    """The history edges between two releases: the last release of their earlier side and the first of their later."""

    model_config = _STRICT
    from_release: int = Field(..., description="The last release of the edges' earlier side.")
    to_release: int = Field(..., description="The first release of the edges' later side.")
    version_changes: int = Field(..., description="Edges from a version of an id to another version of the same id.")
    id_changes: int = Field(..., description="Edges from a version of an id to a version of another id.")
    same_version: int = Field(
        ...,
        description=(
            "Edges from a version to itself, with Ensembl's mapping score: the id and its version kept across a "
            "mapping session (the edge of an id alive at the graph's last release, which has no later side, is not "
            "counted)."
        ),
    )
    retired: int = Field(
        ..., description="Edges from a version to Ensembl's retirement marker of its id (`<id>.Retired`)."
    )
    scored: int = Field(..., description="Of these edges, those with a mapping score of Ensembl's.")
    one_to_many: int | None = Field(
        default=None,
        description=(
            "Gene versions with history edges to two or more distinct gene versions across these releases (the "
            "version itself among them where it is kept; retirements not counted): the fan out of Ensembl's mapping, "
            "counted from the edges' ends, not idtrack's reading of a path's step (`split` of `PathStep.reason`). "
            "Sent by every answer of this version."
        ),
    )
    many_to_one: int | None = Field(
        default=None,
        description=(
            "Gene versions reached by history edges from two or more distinct gene versions across these releases: "
            "the fan in of Ensembl's mapping, counted the same way (not `merge` of `PathStep.reason`). Sent by every "
            "answer of this version."
        ),
    )


class HistoryResponse(BaseModel):
    """Ensembl's stable id history of genes as the graph holds it, counted per release and per transition."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    content_digest: str | None = Field(..., description="The digest of the graph's content counted.")
    releases: list[HistoryRelease] = Field(..., description="Every release of the graph, ascending.")
    transitions: list[HistoryTransition] = Field(
        ..., description="Every pair of releases some history edge spans, ascending."
    )
    compute_seconds: float = Field(..., description="The seconds the server took to count it, at its start.")


#: The text of a release argument, the same in the query and in a body.
RELEASE_TEXT = (
    "An Ensembl release, a whole number from 0 to 999999999 (anything else is `400 invalid_request`); whether the "
    "graph covers it is idtrack's to answer (`400 unknown_release`, with the graph's releases in `allowed`: "
    "`GET /organisms/{organism}` lists them as `releases`)."
)
RELEASE_MAX = 999_999_999


#: idtrack's rule of the release an identifier is read at when none is given (its documentation, "The starting
#: release"), stated wherever ``from_release`` is taken.
FROM_RELEASE_RULE = (
    "Without it, an identifier is read at the target release if it exists there, and otherwise at the latest release "
    "at which it exists (idtrack's rule, the same for Ensembl ids, symbols and other databases' ids); the result says "
    "which release was used (`from_release`) and whether it was chosen (`from_release_inferred`). So a symbol sent "
    "without `from_release` is read as what it names at the target release, not as what it named years ago: give the "
    "release of the list's source to read it as it was then (`POST .../source-inference` finds it for a list)."
)

#: The most characters of a database name the api passes on (the longest of Ensembl's is under 50).
DATABASE_MAX_LENGTH = 200


class BatchRequest(BaseModel):
    """A batch of identifiers converted with the same arguments."""

    model_config = ConfigDict(extra="forbid", strict=True)
    identifiers: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "The identifiers, at most `batch_max` of `GET /limits` (`413 too_many_identifiers` beyond), each at most "
            "`identifier_max_length` characters without control characters (else the whole batch is refused with "
            "`400 invalid_identifier`, `details` naming each such item's index)."
        ),
    )
    from_release: int | None = Field(
        None,
        ge=0,
        le=RELEASE_MAX,
        description=f"The release the identifiers are read at; `null`: inferred. {FROM_RELEASE_RULE} {RELEASE_TEXT}",
    )
    to_release: int | None = Field(
        None,
        ge=0,
        le=RELEASE_MAX,
        description=f"The target release; `null`: the graph's snapshot release. {RELEASE_TEXT}",
    )
    final_database: str | None = Field(
        None,
        json_schema_extra={"minLength": 1, "maxLength": DATABASE_MAX_LENGTH},
        description=(
            "The database of the targets; `null`: `ensembl_gene`. The values a release takes: "
            "`GET /organisms/{organism}/final-databases?to_release=` (for example `HGNC Symbol`, `RefSeq_mRNA`); what "
            "each holds: `kind` of `GET /organisms/{organism}/databases` (NCBI's gene numbers are `EntrezGene`, its "
            "symbols `NCBI gene (formerly Entrezgene)`)."
        ),
    )
    from_database: str | None = Field(
        None,
        json_schema_extra={"minLength": 1, "maxLength": DATABASE_MAX_LENGTH},
        description=(
            "The database the identifiers are meant in; `null`: any. The values: `external_databases` of "
            "`GET /organisms/{organism}` (a database's synonyms are read under its name). An identifier that is not "
            "an id of the database named is read as absent from it (`no_conversion` with `no_gene_at_start`, or "
            "`not_found`), not as retired; some databases come in two forms, accessions and their labels "
            "(`RefSeq_peptide` and `RefSeq peptide`: `kind` of `GET /organisms/{organism}/databases`)."
        ),
    )
    explain: bool = Field(
        default=False, description="Add the path of every candidate (`true` makes answers much larger)."
    )
    allow_bridges: bool = Field(
        default=True, description="Allow bridges through ids two genes share when history ends."
    )
    read_copies: bool = Field(
        default=True,
        description=(
            "`true` (idtrack's reading of a batch): an item that is another item of the same batch with `-1`, `.1` or "
            "`_1` appended, and is itself no exact name, is answered as that item's copy (`match` begins with "
            "`copy:`), so an item's answer can depend on the other items of its batch; keep such names in one batch. "
            "`false`: every item is converted alone, as `GET .../convert` converts it."
        ),
    )


class SourceInferenceRequest(BaseModel):
    """A list of identifiers whose source (release, assembly, database) is asked."""

    model_config = ConfigDict(extra="forbid", strict=True)
    identifiers: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "The identifiers, as a list from one source holds them (at most `batch_max` of `GET /limits`, each checked "
            "as a batch's): each distinct identifier counts once at every origin at which it is an identifier, read "
            "as it was at each release."
        ),
    )
    mode: Literal["assembly_release", "release", "assembly", "complete"] = Field(
        "assembly_release",
        description="What an origin is (`source_modes` of `GET /vocabulary`); default `[assembly, release]`.",
    )


class Origin(BaseModel):
    """An origin of a list, its parts named (those the mode has no part for are `null`)."""

    model_config = _STRICT
    database: str | None = Field(..., description="The database (mode `complete`).")
    assembly: int | None = Field(
        ...,
        description=(
            "The genome assembly, by its key in idtrack's organism table (modes `assembly_release`, `assembly`, "
            "`complete`)."
        ),
    )
    release: int | None = Field(
        ..., description="The Ensembl release (modes `assembly_release`, `release`, `complete`)."
    )


class SourceInferenceResponse(BaseModel):
    """Where a list of identifiers comes from: idtrack's ``API.source_inference``, with the best origin named."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    mode: str = Field(..., description="The mode asked (`source_modes` of `GET /vocabulary`).")
    best: Origin | None = Field(
        ...,
        description=(
            "The band's first origin (the best), its parts named; `null` when the band is empty. The same origin is "
            "`inference.band[0]`, written as idtrack writes an origin of the mode."
        ),
    )
    from_release: int | None = Field(
        ...,
        description=(
            "The release of the best origin: the release to send as `from_release` when the list is converted, so each "
            "identifier is read as it was then; `null` in mode `assembly` (an origin without a release) or with no "
            "band."
        ),
    )
    inference: SourceInferenceModel = Field(  # type: ignore[valid-type]
        ...,
        description=(
            "idtrack's `SourceInference.to_dict()`: the band of origins the list cannot tell apart from the best, best "
            "first, the margin and every origin's count; an origin is written by the mode (`[assembly, release]`, a "
            "release, an assembly, or `[database, assembly, release]`)."
        ),
    )


class DatabaseConversion(BaseModel):
    """One identifier converted into one database."""

    model_config = _STRICT
    database: str = Field(..., description="The database asked for (`final_database`).")
    result: ConversionResultModel = Field(  # type: ignore[valid-type]
        ...,
        description=(
            "The result, exactly as `GET .../convert` answers it with this `final_database` (and without `explain`): "
            "for `no_target` its `final_database` is `ensembl_gene`, so `database` keeps the one asked for."
        ),
    )


class EachDatabaseArguments(BaseModel):
    """The arguments of `convert/each-database` as the api read them (`null`: not given, the default applies)."""

    model_config = _STRICT
    identifier: str = Field(..., description="The identifier, as sent.")
    from_release: int | None = Field(..., description="`from_release` of the query.")
    to_release: int | None = Field(..., description="`to_release` of the query (the one used: `to_release` above).")
    from_database: str | None = Field(..., description="`from_database` of the query.")
    allow_bridges: bool = Field(..., description="`allow_bridges` of the query.")


class EachDatabaseResponse(BaseModel):
    """One identifier converted into every database a conversion to the target release can end in."""

    model_config = _STRICT
    organism: str = Field(..., description="The organism.")
    arguments: EachDatabaseArguments = Field(..., description="The arguments, as read.")
    to_release: int = Field(..., description="The target release.")
    conversions: list[DatabaseConversion] = Field(
        ...,
        description=(
            "One conversion per database of `GET .../final-databases?to_release=`, in that order (`ensembl_gene` "
            "among them)."
        ),
    )


__all__ = [
    "DATABASE_MAX_LENGTH",
    "FROM_RELEASE_RULE",
    "BatchArguments",
    "BatchRequest",
    "BatchResponse",
    "BridgeRuleTerm",
    "Caution",
    "CautionAsk",
    "CautionTerm",
    "ConversionResultModel",
    "CpuLoad",
    "CriterionField",
    "CriterionTerm",
    "DatabaseConversion",
    "DatabaseReleases",
    "DatabasesResponse",
    "EachDatabaseArguments",
    "EachDatabaseResponse",
    "ErrorBody",
    "ErrorResponse",
    "ErrorTerm",
    "FinalDatabasesResponse",
    "GenesNamedArguments",
    "GraphDescriptionModel",
    "GraphFile",
    "GraphLoad",
    "GraphVersion",
    "HealthResponse",
    "HistoryRelease",
    "HistoryResponse",
    "HistoryTransition",
    "IndexEndpoint",
    "IndexResponse",
    "LatencyLoad",
    "LimitsResponse",
    "MemoryLoad",
    "NameMatchModel",
    "NamesOfArguments",
    "NamesResponse",
    "OrganismNames",
    "OrganismsResponse",
    "Origin",
    "ProcessLoad",
    "RequestsLoad",
    "ShowcaseCase",
    "ShowcaseItem",
    "ShowcaseQueriesResponse",
    "ShowcaseQuery",
    "ShowcaseQueryCase",
    "ShowcaseQueryItem",
    "ShowcaseResponse",
    "SourceInferenceModel",
    "SourceInferenceRequest",
    "SourceInferenceResponse",
    "StatusResponse",
    "StatusTerm",
    "Term",
    "ValidationDetail",
    "VersionResponse",
    "VocabularyResponse",
    "WorkerLoad",
    "attribute_docs",
    "model_of",
]
