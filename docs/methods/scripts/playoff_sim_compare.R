# nflseedR's side of playoff_sim_compare.py: simulate each checkpoint's
# remaining games with the chances the site used, and save its summary.
# Run by hand from the repo root after `playoff_sim_compare.py prepare`.

suppressPackageStartupMessages(library(nflseedR))
stopifnot(packageVersion("nflseedR") == "2.0.2")

out <- "docs/methods/scripts/out"

# Each unplayed game this week is a home win with its fixed chance, by a
# point either way (the tiebreakers used never read the margin), the same
# draw the site's simulator makes. Nothing carries over between weeks.
# The chances are captured in the function rather than passed through
# nfl_simulations' `...`, which did not reach it; games are matched by
# week and teams, since nflseedR does not keep extra columns.
game_key <- function(week, away, home) paste(week, away, home)
fixed_chances_from <- function(p_home) {
  function(teams, games, week_num, ...) {
    todo <- which(games$week == week_num & is.na(games$result))
    chance <- p_home[game_key(games$week[todo], games$away_team[todo], games$home_team[todo])]
    stopifnot(!anyNA(chance))
    games$result[todo] <- ifelse(runif(length(todo)) < chance, 1L, -1L)
    list(teams = teams, games = games)
  }
}

for (checkpoint in list(c(2023, 12), c(2024, 9))) {
  season <- checkpoint[1]
  week <- checkpoint[2]
  games <- read.csv(file.path(out, sprintf("games_%d_%d.csv", season, week)))
  p_home <- setNames(games$p_home, game_key(games$week, games$away_team, games$home_team))
  games$p_home <- NULL
  games$game_id <- NULL
  # nfl_simulations reads the argument's name, so it has to be a variable.
  fixed_chances <- fixed_chances_from(p_home)
  set.seed(season * 100 + week)
  sims <- nfl_simulations(
    games,
    compute_results = fixed_chances,
    simulations = 10000L,
    tiebreaker_depth = "SOS",
    sim_include = "REG",
    verbosity = "NONE"
  )
  write.csv(sims$overall, file.path(out, sprintf("nflseedr_%d_%d.csv", season, week)), row.names = FALSE)
  cat(sprintf("%d through week %d: done\n", season, week))
}
