// Riot Data Dragon assets, fetched from its public GitHub mirror. TLS stays enabled.
import { mkdir, writeFile, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const ref = process.argv[2] ?? "master";
if (!/^[a-zA-Z0-9._-]{1,80}$/.test(ref))
  throw Error("Expected a GitHub branch or commit");
const base = `https://raw.githubusercontent.com/InFinity54/LoL_DDragon/${ref}/latest`;
async function get(path) {
  const r = await fetch(`${base}/${path}`);
  if (!r.ok) throw Error(`${r.status}: ${path}`);
  return r;
}
const data = await (await get("data/en_US/champion.json")).json();
if (!/^\d+\.\d+\.\d+$/.test(data.version))
  throw Error("Invalid Data Dragon version");
const seen = new Set(),
  champions = Object.values(data.data)
    .map((c) => {
      if (
        !/^\d+$/.test(c.key) ||
        !c.name ||
        !/^[A-Za-z0-9]+\.png$/.test(c.image.full) ||
        seen.has(c.key)
      )
        throw Error("Invalid champion mapping");
      seen.add(c.key);
      return {
        id: c.key,
        name: c.name,
        portrait: `/champions/${c.image.full}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
const staging = await mkdtemp(join(tmpdir(), "draftroom-catalogue-"));
try {
  for (let start = 0; start < champions.length; start += 8)
    await Promise.all(
      champions.slice(start, start + 8).map(async (c) => {
        const file = c.portrait.split("/").at(-1),
          png = Buffer.from(
            await (await get(`img/champion/${file}`)).arrayBuffer(),
          );
        if (
          png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          png.readUInt32BE(16) !== png.readUInt32BE(20) ||
          png.readUInt32BE(16) < 64
        )
          throw Error(`Invalid portrait: ${file}`);
        await writeFile(join(staging, file), png);
      }),
    );
  await mkdir("public/champions", { recursive: true });
  for (const c of champions) {
    const file = c.portrait.split("/").at(-1);
    await copyFile(join(staging, file), `public/champions/${file}`);
  }
  await writeFile(
    "src/data/champions.json",
    JSON.stringify(champions, null, 2) + "\n",
  );
  await writeFile(
    "src/data/catalogue-meta.json",
    JSON.stringify(
      {
        patch: data.version,
        count: champions.length,
        source: `https://ddragon.leagueoflegends.com/cdn/${data.version}/data/en_US/champion.json`,
        mirror: `${base}/data/en_US/champion.json`,
        mirrorCommit: /^[a-f0-9]{40}$/.test(ref) ? ref : null,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Downloaded ${champions.length} champion portraits from Data Dragon ${data.version}. Run npm test && npm run build, then commit the generated assets.`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
