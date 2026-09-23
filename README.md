# NFL Tracker

A modern dark-theme NFL dashboard built for GitHub Pages.

## Live site

**https://ryanehinkle.github.io/sports-tracker/**

## Tabs

### Player Stats

Current NFL regular-season player totals with sortable columns and clickable game logs:

- Player headshot and full name
- Touchdowns (rushing + receiving)
- All-Purpose Yards*
- Receiving yards
- Rushing yards
- Receptions
- Passing touchdowns
- Passing yards

\*For this dashboard, All-Purpose Yards is defined as **rushing + receiving yards** (yards from scrimmage).

### Odds

The Odds tab reads FanDuel's public sportsbook web feed directly from GitHub Actions. There is no paid odds API, subscription, or private API key required.

It supports:

- Player headshots and team badges
- Player/game matchup
- Proposition
- Line
- American odds
- Standard player props
- Alternate/milestone lines when FanDuel posts them
- Search
- Game filter
- Prop-market filter
- Sorting

The scraper discovers the prop tabs FanDuel exposes for each event and combines those player markets into one board.

## Automatic player-stat updates

The workflow in `.github/workflows/update-and-deploy.yml` runs hourly and pulls current regular-season NFL player stats from ESPN's public web API.

## Automatic odds updates

The workflow in `.github/workflows/update-odds.yml` runs automatically:

- Near-term games are refreshed every 4 hours.
- A broader upcoming-slate refresh runs twice per week.
- The workflow can also be run manually.

No API key is needed and no computer needs to stay on.

## GitHub Pages

GitHub Pages should publish from:

- Branch: **main**
- Folder: **/(root)**

Every committed stats or odds refresh is published automatically.

## Data sources

- Player stats/game logs: ESPN public web JSON endpoints
- Player props: FanDuel sportsbook web feed

## Reliability note

FanDuel does not publish an official developer API for sportsbook odds. The odds updater therefore depends on FanDuel's public website data format. It costs nothing to run, but FanDuel can change that format in the future and the scraper may occasionally need maintenance.
