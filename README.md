# Managemint

A task and project planner built by a PhD student for PhD work: say tasks out loud and they land in the right project with the right dates, see every project on one timeline, and get anything with a date in Apple Calendar, Google Calendar or Outlook.

**This is an early test version, shared with friends.** Expect rough edges, and please [tell me what breaks](https://github.com/nicocardenasmiller/managemint-app/issues/new).

## Your own copy, in your own account

Managemint runs in **your own free Cloudflare account**. Nobody else, including me, can see your tasks, and nothing is billed to anyone: one person's use is far inside Cloudflare's free plan. The only cost is your own AI usage (an Anthropic API key for now), typically well under $1 a month.

You'll need (about 15–20 minutes the first time, no terminal):
1. A free [GitHub](https://github.com/signup) account.
2. A free [Cloudflare](https://dash.cloudflare.com/sign-up) account.
3. An AI key. For now that means an Anthropic API key from [console.anthropic.com](https://console.anthropic.com): add $5 of credit, create a key, and set a monthly spending limit (Settings → Limits) so a leaked key can't cost more than that.

Then click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nicocardenasmiller/managemint-app)

Cloudflare copies this project into your GitHub, creates your server and database, and asks for two values:

| Value | What to enter |
|---|---|
| `SETUP_PASSWORD` | Make up a password (8+ characters). You'll use it on your server's setup page. |
| `ANTHROPIC_API_KEY` | Your AI key (from console.anthropic.com). |

When it's done, Cloudflare shows your server's address, ending in `.workers.dev`.

## Set up your server

Open your server's address plus **`/setup`** (for example `https://managemint.yourname.workers.dev/setup`) and enter your setup password. That page lets you:

1. **Check your AI key.**
2. **Add your calendar.** Tap *Subscribe in Apple Calendar* (on a Mac or iPhone), *Add to Google Calendar* (on a computer), or copy the link into Outlook (*Add calendar → Subscribe from web*). Your dated tasks appear in a calendar called "Managemint". The link only goes one way: change tasks in Managemint. Apple updates every 5 to 15 minutes; Google can take up to a day. The link is private; if it leaks, make a new one on the setup page. The web app has the same link under ⌘K → *Calendar link*.
3. **Pair your phone** with a one-time code or QR code. Each device gets its own key, and you can remove a lost device there.
4. **Open the desktop app** (already signed in on that browser). Install it from your browser's menu: Chrome → *Install*, Safari → *File → Add to Dock*.

## Phone app

- **Android:** download the latest APK from [Releases](https://github.com/nicocardenasmiller/managemint-app/releases) and allow installs from your browser when asked. Open it, then on your computer's setup page choose **Pair a device** and tap **Scan pairing code** on the phone.
- **iPhone:** in Safari, open your server address plus `/app/`, then Share → **Add to Home Screen**. Open Managemint from the Home Screen and enter a pairing code from the setup page. (A real iPhone app may come later.)

## Updates

Your copy doesn't update by itself. When a new version is out, open your copy on GitHub, go to **Actions → Update Managemint → Run workflow**. It copies the latest version into your copy (keeping your Worker and database settings) and Cloudflare redeploys it. Database changes are applied during that deploy. If GitHub asks, click *I understand my workflows, go ahead and enable them* first.

## Privacy

Your tasks are stored in your Cloudflare account and sent to Anthropic only to read your voice and typed captures. Your calendar app reads your dated tasks through your private calendar link; anyone with that link can read them, so keep it to yourself.
