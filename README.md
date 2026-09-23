# NFL Player Stats Tracker

A modern dark-theme NFL player-stat dashboard built for GitHub Pages.

## Live site

Once GitHub Pages is enabled from the **main branch / root**, the site will be available at:

**https://ryanehinkle.github.io/sports-tracker/**

## Tracked stats

- Player headshot and full name
- Touchdowns (rushing + receiving)
- All-Purpose Yards*
- Receiving yards
- Rushing yards
- Receptions
- Passing touchdowns
- Passing yards

\*For this dashboard, All-Purpose Yards is defined as **rushing + receiving yards** (yards from scrimmage), so it corresponds directly to the offensive categories shown in the table.

## Automatic updates

The workflow in `.github/workflows/update-and-deploy.yml` runs hourly and pulls current regular-season NFL player stats from ESPN's public web API.

The site therefore checks for fresh totals every hour. ESPN labels its public player-stat tables as **updated nightly**, so the page publishes new numbers on the first hourly check after ESPN makes them available.

No always-on home PC or server is required.

You can also go to **Actions → Update NFL Stats → Run workflow** to force an immediate refresh.

## GitHub Pages setup

In this repository:

1. Open **Settings → Pages**
2. Under **Build and deployment**, choose **Deploy from a branch**
3. Select **main** and **/(root)**, then save

After that, every stats commit is published automatically.

## Data source

The updater uses ESPN's public, undocumented NFL JSON endpoints. Because the API is undocumented, `scripts/update_stats.py` includes defensive parsing and refuses to overwrite the data file if ESPN unexpectedly returns too few players.
