// Capture the actual app, with disposable local example state only.
// Start `npm run dev -- --port 5173`, then `node scripts/capture-guide.mjs`.
import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.GUIDE_CAPTURE_URL??'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Use a local development server for example rooms');
const output='public/guide';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1320,height:1500},deviceScaleFactor:1});
const meta={};
async function box(locator){const b=await locator.boundingBox();if(!b)throw Error('Missing capture target');return b;}
function union(boxes,pad=10){const x=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.x))-pad)),y=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.y))-pad));return {x,y,width:Math.ceil(Math.max(...boxes.map(b=>b.x+b.width))+pad-x),height:Math.ceil(Math.max(...boxes.map(b=>b.y+b.height))+pad-y)};}
async function capture(name,clip,focus=[],p=page){
 await p.evaluate(()=>Promise.all([...document.images].filter(i=>i.loading!=='lazy'||i.getBoundingClientRect().top<innerHeight).map(i=>i.decode().catch(()=>{}))));
 clip={x:Math.round(clip.x),y:Math.round(clip.y),width:Math.round(clip.width),height:Math.round(clip.height)};
 await p.screenshot({path:`${output}/${name}.png`,clip,animations:'disabled'});
 meta[name]={width:clip.width,height:clip.height,focus:focus.map((b,i)=>({x:Math.max(2,Math.round(b.x-clip.x-4)),y:Math.max(2,Math.round(b.y-clip.y-4)),w:Math.min(clip.width-4,Math.round(b.width+8)),h:Math.min(clip.height-4,Math.round(b.height+8)),n:i+1}))};
 console.log(name,meta[name].width,meta[name].height);
}
async function seed(kind){
 await page.goto(base);await page.evaluate(async kind=>{
  const {initialState}=await import('/src/data/provider.ts');const {startDraft,finishChoice,chooseBan}=await import('/src/domain/progression.ts');const {place}=await import('/src/domain/state.ts');
  let s=initialState('local-player','Mira','ranked');
  s.roleCatalogue.entries.forEach(e=>e.games*=20);
  s.players=[{id:'local-player',name:'Mira',role:'Top',pool:['58','122','164']},{id:'example-jules',name:'Jules',role:'Mid',pool:['103','84','61']},{id:'example-alex',name:'Alex',role:null,pool:[]}];
  s.rolePools={ally:{Jungle:['64','59','104'],ADC:['202','51','222'],Support:['412','89','117']},enemy:{Top:['122','164'],Jungle:['104','59'],Mid:['84','61'],ADC:['51','202'],Support:['89','117']}};
  if(kind==='turn'){
   s=startDraft(s);for(const [t,ids]of [['ally',['157','238','54','875','86']],['enemy',['555','53','245','236','777']]])for(let i=0;i<5;i++)s=chooseBan(s,t,i,ids[i]);
   s=finishChoice(place(s,'ally','Top','58'));
  }else if(kind==='complete'||kind==='import'){
   s=startDraft(s);s.openDraft=true;s.draftStep=0;s.draftHistory=[];
   s.picks={ally:[{role:'Top',championId:'58'},{role:'Jungle',championId:'64'},{role:'Mid',championId:'103'},{role:'ADC',championId:'222'},{role:'Support',championId:'412'}],enemy:[{role:'Top',championId:'122'},{role:'Jungle',championId:'104'},{role:'Mid',championId:'84'},{role:'ADC',championId:'51'},{role:'Support',championId:'89'}]};
  }
  const room={id:'guide-example',slug:'guide-example',name:"Mira's room",host_id:'local-player',version:0,state:s};
  localStorage.setItem('draftroom-demo',JSON.stringify(room));localStorage.setItem('draftroom-current',room.slug);localStorage.setItem('draftroom-show-best-fits','true');
 },kind);await page.goto(base+'/rooms/guide-example/'+(kind==='lobby'?'setup':'draft'));await expect(page.getByRole('heading',{name:kind==='lobby'?'Ally team':'Draft board',exact:true})).toBeVisible();
}
try{
 // A read-only capture of the public home keeps its real Create private room label.
 const home=await browser.newPage({viewport:{width:1000,height:1000},ignoreHTTPSErrors:true});await home.goto('https://draftroom-lol.netlify.app');await home.getByLabel('Display name',{exact:true}).fill('Mira');await expect(home.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
 const account=await box(home.locator('.account-home')),entry=await box(home.locator('.entry'));await capture('start',union([account,entry],18),[account,union([await box(home.locator('.draft-mode-choice')),await box(home.locator('.entry .primary'))],0)],home);await home.close();
 await seed('lobby');const participant=await box(page.getByRole('region',{name:'Room participants'})),roster=await box(page.locator('.setup-page'));await capture('lobby',union([participant,roster],14),[await box(page.getByRole('region',{name:'Observers'})),await box(page.getByRole('region',{name:'Ally team side'})),await box(page.getByRole('group',{name:'Mid role',exact:true}))]);
 await page.getByRole('button',{name:'Add champion to Mid pool',exact:true}).click();await capture('candidates',await box(page.getByRole('dialog')),[]);await page.getByRole('button',{name:'Close',exact:true}).click();
 await seed('turn');const board=await box(page.locator('.integrated-board')),row=await box(page.locator('.board-row').first());await capture('draft',{x:board.x,y:board.y,width:board.width,height:row.y+row.height-board.y+10},[await box(page.getByRole('region',{name:'Draft progression'})),await box(page.getByRole('region',{name:'Top ally picks',exact:true}))]);
 await seed('complete');await capture('scores',union([await box(page.locator('.board-head')),await box(page.locator('.draft-evaluation'))],8),[await box(page.locator('.board-head')),await box(page.locator('.draft-evaluation'))]);
 const tile=page.getByRole('button',{name:'Pick Camille Top ally',exact:true});await tile.hover();await expect(page.getByRole('tooltip')).toBeVisible();await capture('comparison',union([await box(page.getByRole('tooltip'))],12),[]);await page.keyboard.press('Escape');
 await capture('import',union([await box(page.getByRole('region',{name:'Screenshot import'}))],10),[]);
 writeFileSync('src/pages/guide-screens.json',JSON.stringify(meta,null,2)+'\n');
}finally{await browser.close();}
