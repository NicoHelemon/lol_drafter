import {it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {canSelectPick,canRequestPickMove} from '../src/domain/pickPermissions';
it('protects other occupied picks, allows the owner and host, and leaves candidates outside this permission',()=>{
 const s=initialState('a','A');s.players=[{id:'a',name:'A',role:'Top',pool:[]},{id:'b',name:'B',role:'Mid',pool:[]},{id:'c',name:'C',role:null,pool:[]}];
 expect(canSelectPick(s,'a',false,'ally','Top')).toBe(true);expect(canSelectPick(s,'a',false,'ally','Mid')).toBe(false);expect(canSelectPick(s,'a',false,'ally','Jungle')).toBe(true);expect(canSelectPick(s,'a',false,'enemy','Mid')).toBe(true);expect(canSelectPick(s,'c',false,'enemy','Mid')).toBe(false);expect(canSelectPick(s,'c',true,'ally','Mid')).toBe(true);
 expect(canRequestPickMove(s,'a',false,'ally','Top','Mid')).toBe(true);expect(canRequestPickMove(s,'a',false,'ally','Mid','Top')).toBe(false);expect(canRequestPickMove(s,'a',false,'ally','Jungle','Mid')).toBe(false);
});
