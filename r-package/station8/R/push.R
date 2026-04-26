#' Push a single knitted HTML file to Station 8 right now.
#'
#' Used by the auto_push() hook, but exported so users can also call manually.
#' @export
push_now <- function(html_path, report_name = NULL, rmd_path = NULL) {
  if (!file.exists(html_path)) {
    message("[station8] push skipped: html not found at ", html_path)
    return(invisible(FALSE))
  }
  token <- station8_token()
  if (is.null(token)) {
    message("[station8] no token; run station8::configure() first")
    return(invisible(FALSE))
  }
  if (is.null(report_name)) {
    report_name <- tools::file_path_sans_ext(basename(html_path))
  }
  if (is.null(rmd_path)) {
    rmd_path <- sub("\\.html$", ".Rmd", html_path)
  }
  path_hash <- station8_path_hash(rmd_path)
  override <- station8_override_name(rmd_path)

  body <- list(
    html = curl::form_file(html_path, type = "text/html"),
    name = report_name,
    path_hash = path_hash
  )
  if (!is.null(override)) body$override_name <- override

  url <- paste0(station8_hub_url(), "/api/reports/push")
  resp <- tryCatch(
    do.call(
      httr2::req_body_multipart,
      c(
        list(
          httr2::req_headers(
            httr2::request(url),
            Authorization = paste("Bearer", token)
          )
        ),
        body
      )
    ) |> httr2::req_perform(),
    error = function(e) {
      message("[station8] push failed: ", conditionMessage(e))
      NULL
    }
  )
  if (is.null(resp)) return(invisible(FALSE))
  if (httr2::resp_status(resp) >= 400) {
    message("[station8] push rejected: HTTP ", httr2::resp_status(resp))
    return(invisible(FALSE))
  }
  message("[station8] pushed: ", report_name)
  invisible(TRUE)
}
