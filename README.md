# FirstDownStudio Compare (nightly refresh)

Static player-comparison app. A GitHub Actions workflow fetches the First Down
Studio rankings every night, writes `site/data.json`, and deploys `site/` to GitHub Pages.

## Setup
1. Create a GitHub repo and push these files to the `main` branch.
2. Repo Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Actions tab > "Nightly refresh and deploy" > Run workflow (first run).
4. Your site appears at the URL shown in the deploy step.

## Notes
- Schedule: edit the `cron` line in `.github/workflows/nightly.yml` (UTC).
- If the site changes its layout, the fetch step fails and nothing is deployed,
  so the last good data stays live. Fix `scripts/fetch-data.mjs`.
- Run locally: `npm install && node scripts/fetch-data.mjs`, then serve `site/`.
- Set a contact in the user-agent via the `SCRAPER_UA` env var if you like.
- Check First Down Studio's terms before automating requests.
