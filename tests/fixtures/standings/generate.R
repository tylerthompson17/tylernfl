# Standings fixtures from nflseedR, the reference the site's tiebreakers are
# checked against (pipelines/test_standings.py). A dev tool only: nothing on
# the site or in CI runs R.
#
# For each season, standings after every week from 4 to 18: mid-season is
# where ties pile up, so this exercises far more tiebreakers than final
# standings alone. nflseedR's default depth is used (through strength of
# schedule, then a coin toss); rows it settled by coin toss are marked, and
# the tests skip them because nflseedR draws those at random.
#
# Regenerate from the repo root:
#   Rscript tests/fixtures/standings/generate.R
suppressPackageStartupMessages({
  library(nflseedR)
  library(nflreadr)
})

seasons <- c(2022, 2023, 2024)
out <- list()
all_games <- list()
for (season in seasons) {
  games <- load_schedules(season)
  games <- games[games$game_type == "REG", ]
  all_games[[length(all_games) + 1]] <- as.data.frame(games)[, c(
    "season", "week", "game_type", "away_team", "home_team", "away_score", "home_score"
  )]
  for (through in 4:18) {
    played <- games[games$week <= through & !is.na(games$result), ]
    # nflseedR gives up on a few snapshots ("Entered infinite loop in
    # conference tiebreaking procedure"); those are left out and listed.
    s <- tryCatch(
      nfl_standings(played, ranks = "CONF", verbosity = "NONE"),
      error = function(e) { cat("skipped", season, "week", through, ":", conditionMessage(e), "\n"); NULL }
    )
    if (is.null(s)) next
    s$through_week <- through
    out[[length(out) + 1]] <- s
  }
}
all <- do.call(rbind, lapply(out, function(s) as.data.frame(s)[, c(
  "season", "through_week", "conf", "division", "team", "games", "wins",
  "losses", "ties", "pf", "pa", "win_pct", "div_pct", "conf_pct", "sov",
  "sos", "div_rank", "conf_rank", "div_tie_broken_by", "conf_tie_broken_by"
)]))
all$team[all$team == "LA"] <- "LAR"
write.csv(all, "tests/fixtures/standings/nflseedr.csv", row.names = FALSE, na = "")
# The games themselves, so the Python tests run offline.
write.csv(do.call(rbind, all_games), "tests/fixtures/standings/games.csv", row.names = FALSE, na = "")
cat(nrow(all), "rows\n")
cat("coin tosses:", sum(grepl("Coin", all$div_tie_broken_by) | grepl("Coin", all$conf_tie_broken_by)), "\n")
