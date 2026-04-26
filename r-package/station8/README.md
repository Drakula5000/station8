# station8 — push knitted RMarkdown reports to Station 8

## Install

```r
# from a local clone
install.packages("/path/to/r-package/station8", repos = NULL, type = "source")
```

## One-time setup

```r
station8::configure()
```

This prompts for your hub URL (your Render backend URL) and your owner password, then stores a long-lived token at `~/.station8/token`.

Then add this to `~/.Rprofile`:

```r
station8::auto_push()
```

## Usage

Just knit `.Rmd` files normally. After each knit, a macOS dialog asks whether to push to Station 8. The default is "Push" (Enter); 30-second auto-Skip if you walk away.

## Identity

Reports are deduplicated by sha256 of the `.Rmd` absolute path. Move the file = new report. To preserve identity across moves, add this to the top of the `.Rmd`:

```r
# @station8: name = "Q3 churn"
```
