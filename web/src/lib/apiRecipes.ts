// The API page's recipes for a whole feature list over HTTP, in Python (requests) and R (httr2). Written as plain text
// (String.raw: a backslash in the recipe is the recipe's own, never JavaScript's), and checked by tests/apiRecipes.test.ts:
// the Python is parsed by Python, the R by R where it is installed.
//
// A list is read as it was when it was made: the release of its annotation is given (FROM_RELEASE), or asked of the
// API from the list itself (`POST .../source-inference` in the mode `release`). IDTrack answers with a band (the
// releases the list cannot tell apart from the best one) and a margin (by how many identifiers the best release leads
// the best one outside the band; null where no release lies outside it: IDTrack's documentation, "Where a list comes
// from"). One rule decides, as on the site's own pages: where the margin is a number, every batch is read at the
// inferred `from_release`; where it is null the list does not date itself, and each identifier is read at its own
// release (no `from_release` sent), with a warning. The band and the margin are written in the table's first line.
//
// A batch's answers can depend on its members (`read_copies`, on by default: IDTrack answers an item that is another
// item of the batch with `-`, `_` or `.` and a number appended as its copy, `idtrack.ids.NUMBERED_SUFFIX`), so the
// recipes never split a name from its copies: they tie the items by IDTrack's rule, through chains (as the API's own
// `batch_groups` does), fill each request with whole groups up to `batch_max`, and write the answers in the order
// given, with how each was read (`match`), the bridges it crossed and the criterion that decided it. They wait as told
// on 429 and 503 (`Retry-After`, longer each time), and where `request_budget_exceeded` comes again for the same
// request they send it in halves, groups kept whole. The graph is the one every answer names (`Idtrack-Graph-Digest`
// of each batch's answer, checked to be one), written with the releases in the table's first line.

/** The recipe in Python, against `base` (the api's address, `…/api/v1`). */
export function pipelinePython(base: string): string {
  return String.raw`import csv, re, sys, time, requests

BASE = "${base}"
ORGANISM = "homo_sapiens"
FROM_RELEASE = None  # the Ensembl release of the list's annotation (e.g. 98); None: inferred from the list


class Smaller(Exception):
    """The API asks for a smaller request: request_budget_exceeded came again for the same one."""


def call(method, path, **kwargs):
    budget = 0
    for attempt in range(8):
        answer = requests.request(method, BASE + path, timeout=60, **kwargs)
        is_json = answer.headers.get("Content-Type", "").startswith("application/json")
        error = answer.json()["error"] if answer.status_code >= 400 and is_json else None
        if answer.status_code in (429, 503):  # wait as told (Retry-After), longer each time
            if error and error["code"] == "request_budget_exceeded":
                budget += 1
                if budget == 2:
                    raise Smaller(error["message"])
            time.sleep(int(answer.headers.get("Retry-After", "1")) * 2 ** min(attempt, 4))
            continue
        if error:
            raise RuntimeError(f"{error['code']}: {error['message']} (request {error['request_id']})")
        answer.raise_for_status()  # not the API's answer (a proxy's page, for one)
        return answer
    raise RuntimeError(f"{path}: still refused after 8 attempts")

identifiers = ["TP53", "TP53-1", "BRCA1", "ENSG00000146648", "NOT_A_GENE"]  # e.g. adata.var_names
size = call("GET", "/limits").json()["batch_max"]

if FROM_RELEASE is None:  # read each name as it was when the list was made, where the list tells when
    inferred = call(
        "POST", f"/organisms/{ORGANISM}/source-inference", json={"identifiers": identifiers[:size], "mode": "release"}
    ).json()
    band, margin = inferred["inference"]["band"], inferred["inference"]["margin"]
    span = f"band {min(band)} to {max(band)}, {len(band)} releases, margin {'null' if margin is None else margin}"
    if margin is None:  # no release lies outside the band: the list does not date itself
        read_at = f"none, each identifier at its own release (source inference: {span}; the list does not date itself)"
        print(f"warning: the list fits every release ({span}); each identifier is read at its own release", file=sys.stderr)
    else:
        FROM_RELEASE = inferred["from_release"]
        read_at = f"{FROM_RELEASE} (source inference: {span})"
else:
    read_at = f"{FROM_RELEASE} (given)"

def batches(identifiers, size):
    """The requests of a list, a name and its copies always in one.

    IDTrack's rule (idtrack.ids.NUMBERED_SUFFIX): an item that is another item of the same batch with "-", "_"
    or "." and a number appended may be answered as that item's copy, within one batch only; such items are
    tied, through chains too (TP53, TP53-1, TP53-1-2), and each tied group goes whole into one request.
    """
    copy_of = re.compile(r"^(.+)([-_.])([0-9]+)$")
    given = set(identifiers)
    root = {name: name for name in identifiers}

    def find(name):
        while root[name] != name:
            name = root[name]
        return name

    for name in identifiers:
        found = copy_of.match(name.strip())
        if found and found.group(1) in given:
            root[find(name)] = find(found.group(1))
    groups = {}
    for name in dict.fromkeys(identifiers):
        groups.setdefault(find(name), []).append(name)
    chunks, chunk = [], []
    for members in groups.values():
        if chunk and len(chunk) + len(members) > size:
            chunks.append(chunk)
            chunk = []
        chunk += members
    return chunks + ([chunk] if chunk else [])

answers, graphs, targets = {}, set(), set()
waiting = batches(identifiers, size)
while waiting:
    chunk = waiting.pop(0)
    body = {"identifiers": chunk, "from_release": FROM_RELEASE, "final_database": "HGNC Symbol"}
    try:
        response = call("POST", f"/organisms/{ORGANISM}/convert/batch", json=body)
    except Smaller:
        halves = batches(chunk, (len(chunk) + 1) // 2)  # a name and its copies stay together
        if len(halves) == 1:
            raise
        waiting[:0] = halves
        continue
    graphs.add(response.headers["Idtrack-Graph-Digest"])  # the graph that answered
    for result in response.json()["results"]:
        targets.add(result["to_release"])
        answered = result["status"] in ("converted", "tie")  # only these answer in the database asked
        best = [c for c in result["candidates"] if c["best"]] if answered else []
        answers[result["query_id"]] = [
            result["status"],
            ";".join(c["target"] for c in best),
            result["match"] or "",  # how the string was read: synonym:, copy:, ...
            max((c["bridges"] for c in best), default=0),  # above 0: IDTrack's inference, not Ensembl's history
            result["decided_by"] or "",
        ]
assert len(graphs) == 1, f"the graph changed during the run: {graphs}"

with open("mapping.tsv", "w", newline="") as out:
    out.write(f"# IDTrack {BASE}, {ORGANISM} graph {graphs.pop()}, from_release {read_at}, to_release {targets.pop()}\n")
    rows = [[name, *answers[name]] for name in identifiers]
    csv.writer(out, delimiter="\t", lineterminator="\n").writerows([["query", "status", "best", "match", "bridges", "decided_by"], *rows])`;
}

/** The recipe in R, against `base`. */
export function pipelineR(base: string): string {
  return String.raw`library(httr2)

base <- "${base}"
organism <- "homo_sapiens"
from_release <- NULL  # the Ensembl release of the list's annotation (e.g. 98); NULL: inferred from the list

# One request, waiting as told on 429 and 503 (Retry-After, longer each time); a request_budget_exceeded that comes
# again for the same request stops with the class "smaller": the API asks for a smaller request.
call <- function(req) {
  budget <- 0
  for (attempt in 0:7) {
    response <- req |> req_error(is_error = \(r) FALSE) |> req_perform()
    status <- resp_status(response)
    error <- if (status >= 400 && grepl("json", resp_content_type(response))) resp_body_json(response)$error
    if (status %in% c(429, 503)) {
      if (!is.null(error) && error$code == "request_budget_exceeded") {
        budget <- budget + 1
        if (budget == 2) stop(structure(class = c("smaller", "error", "condition"),
          list(message = error$message, call = NULL)))
      }
      wait <- resp_header(response, "Retry-After")
      Sys.sleep(as.numeric(if (is.null(wait)) "1" else wait) * 2^min(attempt, 4))
      next
    }
    if (!is.null(error)) stop(paste0(error$code, ": ", error$message, " (request ", error$request_id, ")"))
    if (status >= 400) stop(paste("HTTP", status))  # not the API's answer (a proxy's page, for one)
    return(response)
  }
  stop("still refused after 8 attempts")
}

identifiers <- c("TP53", "TP53-1", "BRCA1", "ENSG00000146648", "NOT_A_GENE")
size <- resp_body_json(call(request(paste0(base, "/limits"))))$batch_max

if (is.null(from_release)) {  # read each name as it was when the list was made, where the list tells when
  inferred <- resp_body_json(call(request(paste0(base, "/organisms/", organism, "/source-inference")) |>
    req_body_json(list(identifiers = as.list(head(identifiers, size)), mode = "release"))))
  band <- unlist(inferred$inference$band)
  margin <- inferred$inference$margin
  span <- sprintf("band %s to %s, %s releases, margin %s", min(band), max(band), length(band),
    if (is.null(margin)) "null" else margin)
  if (is.null(margin)) {  # no release lies outside the band: the list does not date itself
    read_at <- sprintf("none, each identifier at its own release (source inference: %s; the list does not date itself)", span)
    warning(sprintf("the list fits every release (%s); each identifier is read at its own release", span))
  } else {
    from_release <- inferred$from_release
    read_at <- sprintf("%s (source inference: %s)", from_release, span)
  }
} else {
  read_at <- sprintf("%s (given)", from_release)
}

# The requests of a list, a name and its copies always in one. IDTrack's rule (idtrack.ids.NUMBERED_SUFFIX): an
# item that is another item of the same batch with "-", "_" or "." and a number appended may be answered as that
# item's copy, within one batch only; such items are tied, through chains too (TP53, TP53-1, TP53-1-2), and each
# tied group goes whole into one request.
batches <- function(identifiers, size) {
  root <- setNames(identifiers, identifiers)
  find <- function(name) {
    while (root[[name]] != name) name <- root[[name]]
    name
  }
  for (name in identifiers) {
    found <- regmatches(trimws(name), regexec("^(.+)([-_.])([0-9]+)$", trimws(name)))[[1]]
    if (length(found) && found[2] %in% identifiers) root[[find(name)]] <- find(found[2])
  }
  distinct <- unique(identifiers)
  groups <- split(distinct, factor(vapply(distinct, find, ""), levels = unique(vapply(distinct, find, ""))))
  chunks <- list()
  chunk <- character()
  for (members in groups) {
    if (length(chunk) > 0 && length(chunk) + length(members) > size) {
      chunks[[length(chunks) + 1]] <- chunk
      chunk <- character()
    }
    chunk <- c(chunk, members)
  }
  if (length(chunk) > 0) chunks[[length(chunks) + 1]] <- chunk
  chunks
}

rows <- list()
graphs <- character()
targets <- integer()
waiting <- batches(identifiers, size)
while (length(waiting) > 0) {
  chunk <- waiting[[1]]
  waiting <- waiting[-1]
  body <- list(identifiers = as.list(chunk), final_database = "HGNC Symbol")
  body$from_release <- from_release  # left out where NULL: each identifier at its own release
  response <- tryCatch(
    call(request(paste0(base, "/organisms/", organism, "/convert/batch")) |> req_body_json(body)),
    smaller = function(refusal) {
      halves <- batches(chunk, ceiling(length(chunk) / 2))  # a name and its copies stay together
      if (length(halves) == 1) stop(refusal)
      waiting <<- c(halves, waiting)
      NULL
    }
  )
  if (is.null(response)) next
  graphs <- union(graphs, resp_header(response, "Idtrack-Graph-Digest"))  # the graph that answered
  for (result in resp_body_json(response)$results) {
    targets <- union(targets, result$to_release)
    answered <- result$status %in% c("converted", "tie")  # only these answer in the database asked
    best <- if (answered) Filter(\(c) c$best, result$candidates) else list()
    rows[[result$query_id]] <- data.frame(
      query = result$query_id, status = result$status,
      best = paste(vapply(best, \(c) c$target, ""), collapse = ";"),
      match = if (is.null(result$match)) "" else result$match,  # synonym:, copy:, ...
      bridges = max(c(0, vapply(best, \(c) c$bridges, 0))),  # above 0: IDTrack's inference
      decided_by = if (is.null(result$decided_by)) "" else result$decided_by
    )
  }
}
stopifnot("the graph changed during the run" = length(graphs) == 1)

mapping <- do.call(rbind, rows[identifiers])
out <- file("mapping.tsv", "w")
writeLines(sprintf("# IDTrack %s, %s graph %s, from_release %s, to_release %s",
  base, organism, graphs, read_at, targets), out)
write.table(mapping, out, sep = "\t", quote = FALSE, row.names = FALSE)
close(out)`;
}
