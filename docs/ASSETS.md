# Role and swap icons

The five role PNGs in `public/icons` were downloaded, not drawn or generated. They are bundled with the site, so role icons do not depend on third-party image requests.

Source mirror: `Seunghyun0606/lolbody`, pinned to commit `43d64e4e7754e5e2bbbb00e2acb6f60163580315`, directory `front/src/assets/images/position`:

| Local file | Source filename |
| --- | --- |
| `top.png` | `TOP.png` |
| `jungle.png` | `JUNGLE.png` |
| `mid.png` | `MID.png` |
| `bottom.png` | `BOTTOM.png` |
| `support.png` | `SUPPORT.png` |

Base URL: https://raw.githubusercontent.com/Seunghyun0606/lolbody/43d64e4e7754e5e2bbbb00e2acb6f60163580315/front/src/assets/images/position/

The League client swap button is referenced at:
https://raw.communitydragon.org/16.1/plugins/rcp-fe-lol-champ-select/global/default/images/summoner/button-swap.png

The client asset path is listed in CommunityDragon's `hashes/lol/hashes.lcu.txt`. Outbound access to CommunityDragon was blocked in the development environment, so that remote image has not been visually verified here and is not bundled. If unavailable in a visitor's browser, a ⇅ symbol appears beside the explicit “Swap role” label.

Artwork belongs to Riot Games; this community application is not affiliated with Riot Games. The mirror is not an official Riot distribution.

## Current champion portraits

173 Data Dragon champion records and PNG portraits are bundled in `src/data/champions.json` and `public/champions`. Version: **16.22.1**, including Zaahen, Yunara and Mel.

Mirror snapshot: https://github.com/InFinity54/LoL_DDragon/tree/dc04342110a9e0d7f76ffc844475070317015216/latest

Catalogue: https://raw.githubusercontent.com/InFinity54/LoL_DDragon/dc04342110a9e0d7f76ffc844475070317015216/latest/data/en_US/champion.json

Each portrait uses the filename supplied in Data Dragon's `image.full`. The catalogue updater verifies unique Riot IDs, PNG signatures and square dimensions, then saves the files locally. The shipped images have been downloaded and the update command was exercised against this pinned snapshot. The mirror is community-maintained; the underlying artwork is Riot Games' Data Dragon content.
