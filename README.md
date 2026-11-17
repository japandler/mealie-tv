# Kitchen Recipes (Samsung TV app for Mealie)

A Tizen web app for the kitchen Frame TV (`QN43LS03BAFXZA`, 2022, Tizen 6.5,
at 192.168.0.9). It shows the recipes in Mealie
(`https://mealie.japandler.tv`) and has a step-by-step cooking mode,
controlled with the TV remote.

## Using it

| Screen | Remote |
|---|---|
| **Tabs** (top row) | Recipes, Cookbooks, Meal plan, Organizers. Moving onto a tab opens it. Down goes to the content; Back from anywhere on the home screen returns to the tabs; Back on the tabs exits. |
| **Recipes** | Search (opens the TV keyboard), All A–Z, Newest, plus today's planned meals above the grid. Arrows move; OK opens a recipe. |
| **Cookbooks** | A tile for each Mealie cookbook, with its recipe count and a photo from its newest recipe. OK lists its recipes. |
| **Meal plan** | The next two weeks, one row per day that has something planned, meals in order (breakfast, lunch, dinner, side, …). Notes without a recipe ("Leftovers") show as plain cards. |
| **Organizers** | Categories, Tags and Tools chips, each with a tile for every organizer that has recipes (empty ones are hidden). OK lists its recipes. |
| **Recipe** | Picture, times, ingredients and steps. *Start cooking* is selected first. When a list is selected, ▲▼ scroll it, ◀▶ switch lists, and Back returns to the grid. |
| **Cooking** | One step at a time in large text, with the ingredients alongside. ◀▶ or OK change step, ▲▼ scroll the ingredients. If a step mentions a time ("cook 8 minutes"), ▶❚❚ starts a timer for it; ▶❚❚ again cancels it. When it ends the screen flashes and beeps until you press a button. Back returns to the recipe. |

The screen saver is off on the recipe and cooking screens, so the TV doesn't
dim mid-recipe.

## How it reaches Mealie

- **Address:** `https://mealie.japandler.tv`, the same as the browser. The
  TV uses Pi-hole for DNS, so the name resolves to the main server.
- **Login:** the app sends a Mealie API token, `MEALIE_TV_TOKEN` in
  `~/.env` ("Kitchen TV" under Mealie's *Profile → API Tokens*). Authelia
  lets Mealie's `/api` through from the LAN only, and Mealie checks the
  token. Recipe pictures need no token.
- **CORS:** the app isn't served from Mealie's own address, so Traefik adds
  CORS headers to `/api` (GET only, no cookies). See the `mealie-api` router
  in `starr/compose.yml`.

## Files

- `config.xml`: the Tizen manifest. App ID `KtchnRcp01.KitchenRecipes`;
  internet and remote-key privileges.
- `index.html`, `css/app.css`, `js/app.js`: the app. Plain HTML, CSS and
  JavaScript for the TV's Chromium 85 engine, with no build step. Avoid
  newer CSS such as `aspect-ratio` and `inset`.
- `js/config.js`: the server address and token, written by
  `./make-config.sh` from `~/.env`. Gitignored; it is never committed.
- `icon.png`: Mealie's 512 px icon.

## Testing without the TV

Open `index.html` in Chrome on a LAN machine after `./make-config.sh`. The
arrow keys, Enter and Escape (Back) work, and `p` stands in for ▶❚❚. From
this server, use headless Chromium with `--network host`, so requests come
from 192.168.0.87 (on the LAN) rather than a Docker address.

## Installing on the TV

```sh
./deploy.sh
```

This writes `js/config.js`, copies the app files into `build/`, signs,
installs and starts it on the TV (about 10 seconds). It needs:

- **Tizen Studio's CLI** in `~/tizen-studio` (official 6.1 installer; the
  download is in `~/tizen-installer`).
- **The TV in developer mode with host IP 192.168.0.87.** To set it, open
  *Apps*, press `1 2 3 4 5` on the remote, and enter the IP. Then hold the
  power button until the logo appears; nothing changes until that full
  restart. The TV only accepts connections from that IP, which is why
  installs go from this wired server: the Wi-Fi blocks the Mac from
  reaching the TV.
- **The `kitchen-tv` signing profile:** a plain Tizen author certificate,
  `~/tizen-studio-data/keystore/author/kitchen-tv.p12`, with password
  `TIZEN_CERT_PASSWORD` in `~/.env`. The 2022 Frame accepts it; no Samsung
  certificate is needed.

**Signing quirk:** without a desktop keyring, the CLI can't read the
passwords it stores in `~/tizen-studio-data/profile/profiles.xml`. After
each run it rewrites them in a form it then rejects ("Invaild password" in
`~/tizen-studio-data/cli/logs/cli.log`). `deploy.sh` resets them in plain
text before every build (the file is mode 600) and answers the CLI's
password prompt through `script`.

**If the TV refuses the connection:** developer mode turns itself off after
a while on some firmware. Check `http://192.168.0.9:8001/api/v2/`
(`developerMode` should be `1` and `developerIP` `192.168.0.87`), set it
again if needed, and restart the TV fully.
