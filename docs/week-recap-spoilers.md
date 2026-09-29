# Spoiler-free week recap (later)

`/week` v1 shows results normally. This is the design for a version people can use to
pick a game to watch without learning how it went. Not built yet.

## Hidden by default

- Each game row shows rank, matchup (team chips, names linked), day and kickoff time.
  Score, label and the excitement numbers sit inside a `<details>` element per game
  ("Show result"): no script, works from the keyboard.
- A "Show all results" link goes to a second static page, `/week/<season>/<week>/results/`,
  which is today's v1 page. The choice lives in the URL, not in browser storage.

## Other things on the page that give results away

- The ticker shows every final's score. On the spoiler-free page it is left out.
- The right rail's playoff picture shows updated records, which gives away every
  result. Also left out.
- Both come back on the results page. A `spoilerFree` setting on `BaseLayout` would
  drop the two.
- Page title, description and link previews name the week, never a result.

## What stays visible anyway

The ranking itself hints at results: the game ranked last was probably not close. The
page should say so plainly:

> Ranked by how close and back-and-forth each game was. The order hints at how games
> went; results stay hidden until you open one.

The ticker's labels on every other page are a smaller issue: the ticker already shows
final scores there. "Comeback" does say more than a score, which was accepted.
