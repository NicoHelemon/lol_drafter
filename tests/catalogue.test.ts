import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {champions} from '../src/data/provider';
import meta from '../src/data/catalogue-meta.json';
it('ships all 173 champions with valid local square portraits from the current catalogue',()=>{
 expect(champions).toHaveLength(173);expect(meta.patch).toBe('16.22.1');expect(new Set(champions.map(c=>c.id)).size).toBe(173);expect(champions.find(c=>c.name==='Zaahen')?.id).toBe('904');
 for(const c of champions){expect(c.portrait).toMatch(/^\/champions\/[A-Za-z0-9]+\.png$/);const png=readFileSync(`public${c.portrait}`);expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(64);}
});
