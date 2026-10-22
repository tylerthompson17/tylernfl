# nflseedR's side of draft_sim_compare.py: simulate each checkpoint's
# remaining regular season with the chances the site used, every playoff
# game at 0.5, and save each simulated season's draft rank.
# Run by hand from the repo root after `playoff_sim_compare.py prepare`.

suppressPackageStartupMessages(library(nflseedR))
stopifnot(packageVersion("nflseedR") == "2.0.2")

out <- "docs/methods/scripts/out"

# As in playoff_sim_compare.R, except that a game with no chance (the
# playoff games nflseedR adds) is even, as on the site.
game_key <- function(week, away, home) paste(week, away, home)
fixed_chances_from <- function(p_home) {
  function(teams, games, week_num, ...) {
    todo <- which(games$week == week_num & is.na(games$result))
    chance <- p_home[game_key(games$week[todo], games$away_team[todo], games$home_team[todo])]
    chance[is.na(chance)] <- 0.5
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
  fixed_chances <- fixed_chances_from(p_home)
  set.seed(season * 100 + week)
  sims <- nfl_simulations(
    games,
    compute_results = fixed_chances,
    simulations = 10000L,
    tiebreaker_depth = "SOS",
    sim_include = "DRAFT",
    verbosity = "NONE"
  )
  picks <- as.data.frame(sims$standings)[, c("sim", "team", "draft_rank")]
  write.csv(picks, file.path(out, sprintf("nflseedr_draft_%d_%d.csv", season, week)), row.names = FALSE)
  cat(sprintf("%d through week %d: done\n", season, week))
}
