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

FanDuel NFL player props are pulled through The Odds API and displayed in a sportsbook-style list. The updater discovers FanDuel's currently available player markets for each event, so standard props and alternate/milestone lines are included automatically when available.

The Odds tab supports:

- Player headshots and team badges
- Player/game matchup
- Proposition
- Line
- American odds
- Search
- Game filter
- Prop-market filter
- Sorting
- FanDuel deep links when supplied by the API

## Automatic player-stat updates

The workflow in `.github/workflows/update-and-deploy.yml` runs hourly and pulls current regular-season NFL player stats from ESPN's public web API.

## Automatic odds updates

The workflow in `.github/workflows/update-odds.yml` refreshes FanDuel props near game time every 4 hours and performs broader refreshes during the week. It preserves future event data between refreshes.

### Required repository secret

The Odds updater needs a The Odds API key stored as a GitHub Actions repository secret:

1. Open **Settings → Secrets and variables → Actions**
2. Choose **New repository secret**
3. Name it exactly **ODDS_API_KEY**
4. Paste your The Odds API key and save
5. Open **Actions → Update NFL Odds → Run workflow**
6. Leave the default lookahead at **168** hours for the first full-week refresh

The API key is only used by GitHub Actions and is never written to the public site.

## GitHub Pages

GitHub Pages should publish from:

- Branch: **main**
- Folder: **/(root)**

Every committed stats or odds refresh is then published automatically.

## Data sources

- Player stats/game logs: ESPN public web JSON endpoints
- Player props: The Odds API, filtered to FanDuel
