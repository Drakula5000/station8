`%||%` <- function(a, b) if (is.null(a) || identical(a, "")) b else a

#' @keywords internal
station8_config_dir <- function() {
  d <- file.path(Sys.getenv("HOME"), ".station8")
  if (!dir.exists(d)) dir.create(d, recursive = TRUE, mode = "0700")
  d
}

#' @keywords internal
station8_token <- function() {
  path <- file.path(station8_config_dir(), "token")
  if (!file.exists(path)) return(NULL)
  trimws(readLines(path, warn = FALSE)[1])
}

#' @keywords internal
station8_hub_url <- function() {
  cfg_path <- file.path(station8_config_dir(), "config.json")
  if (!file.exists(cfg_path)) return("https://YOUR_API_DOMAIN")
  cfg <- jsonlite::fromJSON(cfg_path)
  cfg$hub_url %||% "https://YOUR_API_DOMAIN"
}

#' @keywords internal
station8_path_hash <- function(rmd_path) {
  abs <- normalizePath(rmd_path, mustWork = FALSE)
  digest::digest(abs, algo = "sha256", serialize = FALSE)
}

#' @keywords internal
station8_override_name <- function(rmd_path) {
  if (!file.exists(rmd_path)) return(NULL)
  lines <- readLines(rmd_path, n = 20, warn = FALSE)
  m <- regmatches(lines, regexpr('# @station8:\\s*name\\s*=\\s*"([^"]+)"', lines, perl = TRUE))
  hits <- vapply(m, function(s) sub('.*"([^"]+)".*', "\\1", s), character(1))
  hits <- hits[nzchar(hits)]
  if (length(hits) == 0) return(NULL)
  hits[1]
}
