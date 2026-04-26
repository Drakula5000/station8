#' Interactive one-time setup. Prompts for hub URL + owner password,
#' exchanges them for a long-lived token, stores both at ~/.station8/.
#'
#' @param hub_url Optional hub URL (your Render backend URL). If NULL, prompts interactively.
#' @param password Optional password. If NULL, prompts interactively via \code{getPass::getPass}.
#' @export
configure <- function(hub_url = NULL, password = NULL) {
  if (is.null(hub_url)) {
    cat("Hub URL (your Render backend URL, e.g. https://your-app.onrender.com): ")
    hub_url <- trimws(readLines(con = "stdin", n = 1))
    if (!nzchar(hub_url)) {
      message("[station8] hub URL required; aborted")
      return(invisible(FALSE))
    }
  }

  if (is.null(password)) {
    if (!requireNamespace("getPass", quietly = TRUE)) {
      message("[station8] getPass package not installed; install it or pass `password` argument directly")
      return(invisible(FALSE))
    }
    password <- getPass::getPass("Owner password: ")
  }
  if (!nzchar(password)) {
    message("[station8] password required; aborted")
    return(invisible(FALSE))
  }

  resp <- tryCatch(
    httr2::req_perform(
      httr2::req_body_json(
        httr2::request(paste0(hub_url, "/api/auth/r-token")),
        list(password = password)
      )
    ),
    error = function(e) {
      message("[station8] token exchange failed: ", conditionMessage(e))
      NULL
    }
  )
  if (is.null(resp)) return(invisible(FALSE))
  if (httr2::resp_status(resp) != 200) {
    message("[station8] token exchange rejected: HTTP ", httr2::resp_status(resp))
    return(invisible(FALSE))
  }
  token <- httr2::resp_body_json(resp)$token

  d <- station8_config_dir()
  cfg_path <- file.path(d, "config.json")
  tok_path <- file.path(d, "token")
  writeLines(jsonlite::toJSON(list(hub_url = hub_url), auto_unbox = TRUE), cfg_path)
  writeLines(token, tok_path)
  Sys.chmod(cfg_path, mode = "0600")
  Sys.chmod(tok_path, mode = "0600")

  message("[station8] configured. Add `station8::auto_push()` to ~/.Rprofile.")
  invisible(TRUE)
}
