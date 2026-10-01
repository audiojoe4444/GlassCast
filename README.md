# GlassCast

A sleek, streaming-only podcast player built for **Meta Ray-Ban Display** glasses.
Plain HTML/CSS/JS — no build step, no accounts, no API keys.

![GlassCast](icons/wordmark.png)

## Features

- **Search** the Apple Podcasts directory (works with the glasses' dictation/handwriting composer — results appear as you finish speaking).
- **Add / remove** shows with the `+` button beside each result, or from the show page.
- **Library** home screen, sorted by most recent episode, with a **“N new”** badge per show.
- **Continue listening** card — picks up exactly where you left off.
- **Episodes stay lit until heard.** Unplayed episodes are bright with a glowing dot; heard ones are greyed out, labelled *Played*, and still playable. Half-finished ones show a progress bar and time left.
- **Mark played / unplayed** per episode (the ✓ on the right of each row), plus **Mark all played** for catching up on a new show.
- **Player:** back to start · −15s · play/pause · +30s · skip to end (marks it played), podcast name, and the episode title, which waits and then scrolls slowly **once** if it's too long.
- **Playback speed** (1× → 1.25× → 1.5× → 1.75× → 2× → 0.8×), remembered between sessions.
- **Mini player** at the bottom of every screen while something's loaded.
- **Back** button top-left on every screen, and the glasses' own Back gesture works too.

## Put it on GitHub Pages

1. Create a new public repo (e.g. `glasscast`) and upload **everything in this folder**, including the hidden `.well-known` folder and the `.nojekyll` file.
   - macOS Finder hides dot-files. Press **Cmd + Shift + .** to show them before dragging, or in GitHub use **Add file → Create new file**, type `.well-known/meta-wearables-manifest.json` as the name and paste the contents in.
2. Repo **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main` / `(root)` → Save.
3. After a minute your app is live at `https://<your-username>.github.io/glasscast/`.
4. Check `https://<your-username>.github.io/glasscast/.well-known/meta-wearables-manifest.json` loads (if it 404s, `.nojekyll` is missing).

## Add it to your glasses

In the **Meta AI app** (Developer Mode on): **App Settings → Apps → Web Apps → Connect Web App**, paste your HTTPS URL, **Save**. GlassCast appears at the bottom of your app grid with its own icon.

## Controls

| On the glasses | Does |
|---|---|
| Swipe / arrows | Move between buttons |
| Pinch / tap (Enter) | Select |
| Back gesture | Previous screen |

Testing in desktop Chrome: arrow keys + Enter work (a small built-in navigator kicks in off-device), `Esc` is Back. Force either mode with `?nav=js` or `?nav=native`.

## Files

```
index.html                           app shell
styles.css                           look & feel (black = see-through on the glasses)
app.js                               everything else
icons/                               logo, favicons, monochrome launcher icon
.well-known/meta-wearables-manifest.json   name + icon for the glasses' app grid
.nojekyll                            lets GitHub Pages serve .well-known
```

## Notes

- **Artwork comes from each podcast's own RSS feed** (its `<itunes:image>` / `<image>` cover), so it always matches what the show itself publishes. GlassCast reads only the top of the feed (it stops before the first episode), caches the result for a week, and fills the image in as soon as it's found.
- Some feed hosts don't let web apps read their feeds directly. When that happens GlassCast reads the feed through a public relay (allorigins.win, then codetabs.com). If a feed still can't be reached, it falls back to Apple's copy of the cover so nothing is left blank.
- Show search and episode lists come from Apple's public iTunes Search/Lookup API, which returns up to the **200 most recent** episodes per show.
- Your library, played marks and positions live in the glasses' browser storage for this site. Removing the web app or clearing data resets them.
- Audio streams straight from each podcast's host; nothing is downloaded.
- Meta's docs don't cover background audio, so assume playback stops when you leave the app. Your position is saved every few seconds, so *Continue listening* picks it back up.
