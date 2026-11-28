// The api page's recipes for a whole feature list over HTTP, in Python (requests) and R (httr2). Written as plain text
// (String.raw: a backslash in the recipe is the recipe's own, never JavaScript's), and checked by tests/apiRecipes.test.ts:
// the Python is parsed by Python, the R by R where it is installed.
//
// A list is read as it was when it was made: the release of its annotation is given (FROM_RELEASE), or asked of the
// api from the list itself (`POST .../source-inference`, its `from_release`), and sent with every batch. A batch's
// answers can depend on its members (`read_copies`, on by default: IDTrack answers an item that is another item of the
// batch with `-`, `_` or `.` and a number appended as its copy, `idtrack.ids.NUMBERED_SUFFIX`), so the recipes never
// split a name from its copies: they tie the items by IDTrack's rule, through chains (as the api's own `batch_groups`
// does), fill each request with whole groups up to `batch_max`, and write the answers in the order given, with how each was read (`match`), the bridges it crossed and the criterion that decided it. The graph
// is the one every answer names (`Idtrack-Graph-Digest` of each batch's answer, checked to be one), written with the
// releases in the table's first line.

/** The recipe in Python, against `base` (the api's address, `…/api/v1`). */
export function pipelinePython(base: string): string {
  return String.raw`import csv, re, time, requests

BASE = "${base}"
ORGANISM = "homo_sapiens"
FROM_RELEASE = None  # the Ensembl release of the list's annotation (e.g. 98); None: inferred from the list

def call(method, path, **kwargs):
    for attempt in range(8):
        answer = requests.request(method, BASE + path, timeout=60, **kwargs)
        if answer.status_code in (429, 503):  # wait as told, longer each time
            time.sleep(int(answer.headers.get("Retry-After", "1")) * 2 ** min(attempt, 4))
            continue
        if answer.status_code >= 400:
            error = answer.json()["error"]
            raise RuntimeError(f"{error['code']}: {error['message']} (request {error['request_id']})")
        return answer
    raise RuntimeError(f"{path}: still refused after 8 attempts")

identifiers = ["TP53", "TP53-1", "BRCA1", "ENSG00000146648", "NOT_A_GENE"]  # e.g. adata.var_names
size = call("GET", "/limits").json()["batch_max"]

if FROM_RELEASE is None:  # read each name as it was when the list was made, not as it is today
    inferred = call("POST", f"/organisms/{ORGANISM}/source-inference", json={"identifiers": identifiers[:size]})
    FROM_RELEASE = inferred.json()["from_release"]

def batches(identifiers, size):
    """The requests of a list, a name and its copies always in one.

    idtrack's rule (idtrack.ids.NUMBERED_SUFFIX): an item that is another item of the same batch with "-", "_"
    or "." and a number appended may be answered as that item's copy, within one batch only; such items are
    tied, through chains too (TP53, TP53-1, TP53-1-2), and each tied group goes whole into one request (a
    group larger than size is split).
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
for chunk in batches(identifiers, size):
    body = {"identifiers": chunk, "from_release": FROM_RELEASE, "final_database": "HGNC Symbol"}
    response = call("POST", f"/organisms/{ORGANISM}/convert/batch", json=body)
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
    out.write(f"# idtrack-web, {ORGANISM} graph {graphs.pop()}, from_release {FROM_RELEASE}, to_release {targets.pop()}\n")
    rows = [[name, *answers[name]] for name in identifiers]
    csv.writer(out, delimiter="\t").writerows([["query", "status", "best", "match", "bridges", "decided_by"], *rows])`;
}

/** The recipe in R, against `base`. */
export function pipelineR(base: string): string {
  return String.raw`library(httr2)

base <- "${base}"
organism <- "homo_sapiens"
from_release <- NULL  # the Ensembl release of the list's annotation (e.g. 98); NULL: inferred from the list
call <- function(req) {
  req |>
    req_retry(max_tries = 8, is_transient = \(r) resp_status(r) %in% c(429, 503)) |>  # waits Retry-After
    req_error(body = \(r) {
      error <- resp_body_json(r)$error
      paste0(error$code, ": ", error$message, " (request ", error$request_id, ")")
    }) |>
    req_perform()
}

identifiers <- c("TP53", "TP53-1", "BRCA1", "ENSG00000146648", "NOT_A_GENE")
size <- resp_body_json(call(request(paste0(base, "/limits"))))$batch_max

if (is.null(from_release)) {  # read each name as it was when the list was made, not as it is today
  inferred <- call(request(paste0(base, "/organisms/", organism, "/source-inference")) |>
    req_body_json(list(identifiers = as.list(head(identifiers, size)))))
  from_release <- resp_body_json(inferred)$from_release
}

# The requests of a list, a name and its copies always in one. idtrack's rule (idtrack.ids.NUMBERED_SUFFIX): an
# item that is another item of the same batch with "-", "_" or "." and a number appended may be answered as that
# item's copy, within one batch only; such items are tied, through chains too (TP53, TP53-1, TP53-1-2), and each
# tied group goes whole into one request (a group larger than size is split).
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
for (chunk in batches(identifiers, size)) {
  response <- call(request(paste0(base, "/organisms/", organism, "/convert/batch")) |>
    req_body_json(list(identifiers = as.list(chunk), from_release = from_release, final_database = "HGNC Symbol")))
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
writeLines(sprintf("# idtrack-web, %s graph %s, from_release %s, to_release %s",
  organism, graphs, from_release, targets), out)
write.table(mapping, out, sep = "\t", quote = FALSE, row.names = FALSE)
close(out)`;
}
