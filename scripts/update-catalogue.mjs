// Official Riot catalogue only. TLS verification must remain enabled.
import {writeFile} from 'node:fs/promises';
const origin='https://ddragon.leagueoflegends.com';
async function json(url){const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url}`);return response.json();}
const patch=process.argv[2]??(await json(`${origin}/api/versions.json`))[0];
if(!/^\d+\.\d+\.\d+$/.test(patch))throw Error('Expected explicit Data Dragon patch, e.g. 16.1.1');
const data=await json(`${origin}/cdn/${patch}/data/en_US/champion.json`);
const seen=new Set();const champions=Object.values(data.data).map(c=>{if(!/^\d+$/.test(c.key)||!c.name||!c.image.full.endsWith('.png')||seen.has(c.key))throw Error('Invalid catalogue');seen.add(c.key);return {id:c.key,name:c.name,portrait:`${origin}/cdn/${patch}/img/champion/${c.image.full}`};}).sort((a,b)=>a.name.localeCompare(b.name));
await writeFile('src/data/champions.json',JSON.stringify(champions,null,2)+'\n');
await writeFile('src/data/catalogue-meta.json',JSON.stringify({patch,source:`${origin}/cdn/${patch}/data/en_US/champion.json`,mirror:null},null,2)+'\n');
console.log(`Saved ${champions.length} champions from Riot ${patch}. Review the diff and run npm test && npm run build.`);
