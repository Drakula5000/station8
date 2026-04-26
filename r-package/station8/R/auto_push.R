#' Registers a knitr document hook that, after every knit completes,
#' shows a macOS dialog asking whether to push the rendered HTML to Station 8.
#' Idempotent — calling twice replaces the previous hook.
#' @export
auto_push <- function() {
  if (!requireNamespace("knitr", quietly = TRUE)) {
    message("[station8] knitr not installed; auto_push disabled")
    return(invisible(FALSE))
  }
  knitr::knit_hooks$set(document = function(x) {
    out_format <- knitr::opts_knit$get("rmarkdown.pandoc.to")
    if (!identical(out_format, "html")) {
      return(x)
    }
    rmd_path <- knitr::current_input(dir = TRUE)
    if (is.null(rmd_path) || !nzchar(rmd_path)) return(x)
    output_dir <- knitr::opts_knit$get("output.dir") %||% dirname(rmd_path)
    base <- tools::file_path_sans_ext(basename(rmd_path))
    html_path <- file.path(output_dir, paste0(base, ".html"))

    on.exit({
      if (file.exists(html_path)) {
        report_name <- base
        if (station8_prompt(report_name)) {
          push_now(html_path, report_name = report_name, rmd_path = rmd_path)
        } else {
          message("[station8] skipped: ", report_name)
        }
      }
    }, add = TRUE)
    x
  })
  message("[station8] auto-push enabled")
  invisible(TRUE)
}
