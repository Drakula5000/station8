#' @keywords internal
station8_prompt <- function(report_name) {
  if (Sys.info()[["sysname"]] != "Darwin") {
    message("[station8] non-macOS environment, skipping push")
    return(FALSE)
  }
  safe_name <- gsub('"', '\\\\"', report_name)
  script <- sprintf(
    'display dialog "Push %s to Station 8? (HTML knits only)" buttons {"Skip", "Push"} default button "Push" giving up after 30 with title "Station 8"',
    safe_name
  )
  result <- tryCatch(
    suppressWarnings(system2(
      "osascript",
      args = c("-e", shQuote(script)),
      stdout = TRUE, stderr = FALSE
    )),
    error = function(e) ""
  )
  joined <- paste(result, collapse = "")
  grepl("button returned:Push", joined, fixed = TRUE)
}
