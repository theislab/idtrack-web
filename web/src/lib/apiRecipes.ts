// The api page's recipes for a whole feature list over HTTP, in Python (requests) and R (httr2). Written as plain text
// (String.raw: a backslash in the recipe is the recipe's own, never JavaScript's), and checked by tests/apiRecipes.test.ts:
// the Python is parsed by Python, the R by R where it is installed.
//
// A batch's answers can depend on its members (`read_copies`, on by default: an item that is another item with `-1`,
// `.1` or `_1` appended is answered as its copy), so the recipes never split a name from its copies: they group the
// identifiers by the name without such suffixes, fill each request with whole groups up to `batch_max`, and write the
// answers in the order given, with how each was read (`match`), the bridges it crossed and the criterion that decided it.

/** The recipe in Python, against `base` (the api's address, `…/api/v1`). */
export function pipelinePython(base: string): string {
  return String.raw`import csv, re, time, requests

BASE = "${base}"

def call(method, path, **kwargs):
    for attempt in range(8):
        answer = requests.request(method, BASE + path, timeout=60, **kwargs)
        if answer.status_code in (429, 503):  # wait as told, longer each time
            time.sleep(int(answer.headers.get("Retry-After", "1")) * 2 ** min(attempt, 4))
            continue
        if answer.status_code >= 400:
            error = answer.json()["error"]
            raise RuntimeError(f"{error['code']}: {error['message']} (request {error['request_id']})")
        return answer.json()
    raise RuntimeError(f"{path}: still refused after 8 attempts")

identifiers = ["TP53", "TP53-1", "BRCA1", "ENSG00000146648", "NOT_A_GENE"]  # e.g. adata.var_names
size = call("GET", "/limits")["batch_max"]

# An item with -1, .1 or _1 appended can be read as another item's copy, within one batch only:
# keep each name and its copies in the same request (a group larger than batch_max is split).
groups = {}
for name in identifiers:
    groups.setdefault(re.sub(r"([-._]1)+$", "", name), []).append(name)
chunks, chunk = [], []
for members in groups.values():
    if chunk and len(chunk) + len(members) > size:
        chunks.append(chunk)
        chunk = []
    chunk += members
chunks += [chunk] if chunk else []

answers = {}
for chunk in chunks:
    body = {"identifiers": chunk, "final_database": "HGNC Symbol"}
    for result in call("POST", "/organisms/homo_sapiens/convert/batch", json=body)["results"]:
        answered = result["status"] in ("converted", "tie")  # only these answer in the database asked
        best = [c for c in result["candidates"] if c["best"]] if answered else []
        answers[result["query_id"]] = [
            result["status"],
            ";".join(c["target"] for c in best),
            result["match"] or "",  # how the string was read: synonym:, copy:, ...
            max((c["bridges"] for c in best), default=0),  # above 0: idtrack's inference, not Ensembl's history
            result["decided_by"] or "",
        ]

digests = {g["organism"]: g["content_digest"] for g in call("GET", "/version")["graphs"]}
with open("mapping.tsv", "w", newline="") as out:
    out.write(f"# idtrack-web, homo_sapiens graph {digests['homo_sapiens']}\n")
    rows = [[name, *answers[name]] for name in identifiers]
    csv.writer(out, delimiter="\t").writerows([["query", "status", "best", "match", "bridges", "decided_by"], *rows])`;
}

/** The recipe in R, against `base`. */
export function pipelineR(base: string): string {
  return String.raw`library(httr2)

base <- "${base}"
call <- function(req) {
  req |>
    req_retry(max_tries = 8, is_transient = \(r) resp_status(r) %in% c(429, 503)) |>  # waits Retry-After
    req_error(body = \(r) resp_body_json(r)$error$message) |>
    req_perform() |>
    resp_body_json()
}

identifiers <- c("TP53", "TP53-1", "BRCA1", "ENSG00000146648", "NOT_A_GENE")
size <- call(request(paste0(base, "/limits")))$batch_max

# An item with -1, .1 or _1 appended can be read as another item's copy, within one batch only:
# keep each name and its copies in the same request (a group larger than batch_max is split).
groups <- split(identifiers, factor(sub("([-._]1)+$", "", identifiers), levels = unique(sub("([-._]1)+$", "", identifiers))))
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

rows <- list()
for (chunk in chunks) {
  answer <- call(request(paste0(base, "/organisms/homo_sapiens/convert/batch")) |>
    req_body_json(list(identifiers = as.list(chunk), final_database = "HGNC Symbol")))
  for (result in answer$results) {
    answered <- result$status %in% c("converted", "tie")  # only these answer in the database asked
    best <- if (answered) Filter(\(c) c$best, result$candidates) else list()
    rows[[result$query_id]] <- data.frame(
      query = result$query_id, status = result$status,
      best = paste(vapply(best, \(c) c$target, ""), collapse = ";"),
      match = if (is.null(result$match)) "" else result$match,  # synonym:, copy:, ...
      bridges = max(c(0, vapply(best, \(c) c$bridges, 0))),  # above 0: idtrack's inference
      decided_by = if (is.null(result$decided_by)) "" else result$decided_by
    )
  }
}
mapping <- do.call(rbind, rows[identifiers])
print(mapping)`;
}
