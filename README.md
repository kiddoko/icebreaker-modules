# ICEBREAKER modules

The community index of [ICEBREAKER](https://github.com/kiddoko/ICEBREAKER)
modules (and themes): what `plugin search` lists and what `plugin install <id>`
resolves.

```bash
plugin search calendar        # in ICEBREAKER's shell
plugin install hello          # by id, from this index
plugin enable hello           # shows its permissions, asks you
```

## What a module is

One feature = one module. A module brings **shell commands** (always), and
usually an **app** (a screen) and a **HOME widget**. It's a folder:

```
plugin.json   id, name, version, description, author, permissions
main.js       an ES module exporting activate(ib)
README.md     what it does, its commands, what it connects to
```

The full API is documented in ICEBREAKER's
[docs/PLUGINS.md](https://github.com/kiddoko/ICEBREAKER/blob/master/docs/PLUGINS.md)
and `src/plugins/api.ts`. [`modules/hello`](modules/hello) is a complete,
commented example: copy it to start.

## The modules that ship with the deck

Every module ICEBREAKER ships with is listed here too, marked `"builtin": true`:
TODO, CALENDAR, HABITS, MUSIC, REMINDERS, STATS, and the deck's own packages
(NEXUS, UPLINK, JOURNAL, WEATHER, CLOCKS, TERMINAL…). Remove one in MODULES,
put it back from the STORE: the deck's own copy comes back, **nothing is
downloaded**. The bundled ones have their source in [`modules/`](modules) — to
read, and to learn from (`main.ts`, the same `ib` API as yours). The entries are
written by `node scripts/pack-store.mjs <this checkout>` in the ICEBREAKER
repository; don't edit them by hand.

## Verified, and how to get there

**Only maintainers can change this repository**: every change is a pull request, reviewed
and approved before it's merged. A module whose code lives here (`modules/<id>/`) shows as
**✓ verified** in ICEBREAKER's STORE — what was reviewed is exactly what people download.
Entries pointing to another repository, and other indexes, show as **⚠ not verified**, and
ICEBREAKER warns before installing them. Rules and steps: [docs/COMMUNITY.md](https://github.com/kiddoko/ICEBREAKER/blob/master/docs/COMMUNITY.md).

> ICEBREAKER is a hobby project — even a verified module comes with **no warranty**
> ([DISCLAIMER](https://github.com/kiddoko/ICEBREAKER/blob/master/DISCLAIMER.md)).

## Publishing yours

1. Build it in your vault: `plugin new my-thing`, edit, `plugin reload`.
2. Put `plugin.json`, `main.js` and a `README.md` in a public GitHub repo (or a
   folder of one). TypeScript? Bundle it to one `main.js` first.
3. Anyone can already `plugin install you/your-repo`.
4. To be listed here: open a pull request that adds **one entry** to
   [`index.json`](index.json). Small modules can also live in `modules/` here.

```json
{
  "id": "pomodoro",
  "kind": "plugin",
  "name": "Pomodoro",
  "description": "25/5 focus timer: `pomo` command, app and widget",
  "author": "you",
  "repo": "you/icebreaker-pomodoro"
}
```

Themes are listed the same way with `"kind": "theme"` and a `repo` pointing at
the `.toml` file — share them in
[kiddoko/icebreaker-themes](https://github.com/kiddoko/icebreaker-themes) or your own repo.

## Review rules

A module is listed when:

- its repo is public and its `plugin.json` `id` matches the entry's `id`;
- it registers **shell commands** for what it does (every click in ICEBREAKER is a command);
- it asks only for the permissions it uses;
- it works **offline** and **without AI**, or says clearly in its README what
  needs a network or an AI, and where it connects;
- its code is readable: no obfuscation, no minified-beyond-reading bundles, no
  hidden network calls;
- **no images** in its UI: ICEBREAKER is a character grid;
- it never writes data from third-party accounts (Google, etc.) into the vault
  without saying so.

Updates happen in the module's own repo (bump `version`); users run
`plugin update <id>`.
