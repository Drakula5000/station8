#' Wraps rmarkdown::render so that, after every knit completes,
#' a macOS dialog asks whether to push the rendered HTML to Station 8.
#' Idempotent — calling twice does not double-wrap.
#' @export
auto_push <- function() {
  if (!requireNamespace("rmarkdown", quietly = TRUE)) {
    message("[station8] rmarkdown not installed; auto_push disabled")
    return(invisible(FALSE))
  }
  current <- rmarkdown::render
  if (isTRUE(attr(current, "station8_wrapped"))) {
    message("[station8] auto-push already enabled")
    return(invisible(TRUE))
  }
  original_render <- current

  new_render <- function(...) {
    args <- list(...)
    output <- original_render(...)
    if (is.character(output) && length(output) >= 1) {
      out_path <- output[1]
      if (grepl("\\.html$", out_path, ignore.case = TRUE) && file.exists(out_path)) {
        rmd_path <- args$input %||% (if (length(args) >= 1 && is.character(args[[1]])) args[[1]] else NULL)
        base <- tools::file_path_sans_ext(basename(out_path))
        if (!is.null(rmd_path) && nzchar(rmd_path)) {
          if (station8_prompt(base)) {
            push_now(out_path, report_name = base, rmd_path = rmd_path)
          } else {
            message("[station8] skipped: ", base)
          }
        }
      }
    }
    output
  }
  attr(new_render, "station8_wrapped") <- TRUE

  # Pre-create rmarkdown's expected `metadata` binding in the wrapper's env so
  # rmarkdown's internal unlockBinding("metadata", env) call doesn't throw.
  local({
    e <- environment(new_render)
    if (!exists("metadata", envir = e, inherits = FALSE)) {
      assign("metadata", NULL, envir = e)
      lockBinding("metadata", e)
    }
  })

  utils::assignInNamespace("render", new_render, ns = "rmarkdown")
  message("[station8] auto-push enabled")
  invisible(TRUE)
}
