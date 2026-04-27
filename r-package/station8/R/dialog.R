#' @keywords internal
station8_prompt <- function(report_name) {
  os <- Sys.info()[["sysname"]]

  if (os == "Darwin") {
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
    return(grepl("button returned:Push", paste(result, collapse = ""), fixed = TRUE))
  }

  if (os == "Windows") {
    # Try PowerShell dialog; fall back to console prompt if unavailable
    result <- tryCatch({
      ps_cmd <- sprintf(
        'Add-Type -AssemblyName System.Windows.Forms; $r = [System.Windows.Forms.MessageBox]::Show("Push %s to Station 8?","Station 8","YesNo","Question"); Write-Output $r',
        gsub("'", "", report_name)
      )
      out <- suppressWarnings(system2("powershell", c("-NoProfile", "-Command", ps_cmd), stdout = TRUE, stderr = FALSE))
      trimws(paste(out, collapse = "")) == "Yes"
    }, error = function(e) {
      ans <- trimws(readline(sprintf("[station8] Push '%s' to Station 8? (y/n): ", report_name)))
      tolower(ans) == "y"
    })
    return(result)
  }

  # Linux and everything else — zenity if available, otherwise console prompt
  if (os == "Linux") {
    has_zenity <- nchar(Sys.which("zenity")) > 0
    if (has_zenity) {
      exit_code <- suppressWarnings(system2(
        "zenity",
        args = c("--question", sprintf('--text=Push "%s" to Station 8?', report_name), "--title=Station 8"),
        stdout = FALSE, stderr = FALSE
      ))
      return(exit_code == 0)
    }
  }

  # Universal console fallback
  ans <- trimws(readline(sprintf("[station8] Push '%s' to Station 8? (y/n): ", report_name)))
  tolower(ans) == "y"
}
