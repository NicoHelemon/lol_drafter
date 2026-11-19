import {useEffect,useId} from 'react';
import './guide.css';
import screens from './guide-screens.json';
import ExternalArrow from '../components/ExternalArrow';

function Screen({name,alt}:{name:keyof typeof screens;alt:string}){
 const {width,height,focus}=screens[name];
 const id=useId().replace(/:/g,'');
 return <figure className="guide-screen"><a href={`/guide/${name}.png`} target="_blank" rel="noopener noreferrer" aria-label={`${alt} — open full-size image in a new tab`}>
  <img src={`/guide/${name}.png`} alt={alt} width={width} height={height} loading="lazy" decoding="async"/>
  {!!focus.length&&<svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="guide-focus"><defs><mask id={id}><rect width={width} height={height} fill="white"/>{focus.map((f,i)=><rect key={i} x={f.x} y={f.y} width={f.w} height={f.h} rx="8" fill="black"/>)}</mask></defs><rect width={width} height={height} fill="#030813" opacity=".48" mask={`url(#${id})`}/>{focus.map((f,i)=><rect key={i} x={f.x} y={f.y} width={f.w} height={f.h} rx="8" fill="none" stroke="#e8c47e" strokeWidth="2"/>)}</svg>}
  {focus.map((f,i)=><span className="guide-image-pin" aria-hidden="true" key={i} style={{left:`${(f.x+14)/width*100}%`,top:`${(f.y+14)/height*100}%`}}>{f.n}</span>)}
 </a></figure>;
}
const chapters=[['start','Get started'],['prepare','Prepare'],['draft','Draft'],['scores','Read scores'],['import','Import a screenshot']];
export default function UserGuide(){
 useEffect(()=>{document.title='User guide · Draftroom';},[]);
 return <div className="guide-page">
  <header className="guide-header"><a className="brand" href="/" target="_blank" rel="noopener noreferrer">◈ <span>DRAFT<span className="gold">ROOM</span></span></a><span className="guide-header-label">USER GUIDE</span><a className="guide-open" href="/" target="_blank" rel="noopener noreferrer">Open Draftroom <ExternalArrow/></a></header>
  <main className="guide-main" id="top">
   <div className="guide-intro"><h1>User guide</h1></div>
   <nav className="guide-nav" aria-label="Guide chapters">{chapters.map(([id,label],i)=><a href={`#${id}`} key={id}><span>0{i+1}</span>{label}</a>)}</nav>
   <section className="guide-chapter" id="start" aria-labelledby="start-title">
    <div className="guide-chapter-heading"><span className="guide-number">01</span><div><h2 id="start-title">Create or join a room</h2><p>Enter a display name and create a private room, or follow an invitation to join one.</p></div></div>
    <div className="guide-start-layout"><Screen name="start" alt="Home page with optional sign-in, display name and the two draft formats"/><div className="guide-side-notes"><p><b className="guide-pin">1</b><strong>Accounts are optional.</strong> Sign in to save your display name and champion pools. Edit them in <b>My profile</b>.</p><p><b className="guide-pin">2</b><strong>Choose the right format.</strong> <b>Ranked</b> groups the ten bans before picks. <b>Tournament</b> follows the alternating ban/pick phases, including the second ban phase.</p><div className="guide-aside">Already invited? Enter your name and choose <b>Join room</b>.</div></div></div>
   </section>
   <section className="guide-chapter" id="prepare" aria-labelledby="prepare-title">
    <div className="guide-chapter-heading"><span className="guide-number">02</span><div><h2 id="prepare-title">Side, roles and candidates</h2><p>Share <b>Copy invitation</b>. Everyone arrives as an observer; choose <b>Join</b> on a role to play.</p></div></div>
    <Screen name="lobby" alt="Lobby showing the observers area, blue side selection and five role panels with candidate champions"/>
    <div className="guide-three-notes"><p><b className="guide-pin">1</b><strong>Up to ten people.</strong> Five can take allied roles; the rest observe. The host can observe too and transfer hosting.</p><p><b className="guide-pin">2</b><strong>Blue picks first.</strong> The host selects the allied side. Tournament mode also shows the enemy roster; its side changes with yours.</p><p><b className="guide-pin">3</b><strong>Candidate lists.</strong> Use <b>+</b> to prepare any role, occupied or not. A candidate is not a locked pick.</p></div>
    <details className="guide-detail"><summary>Finding champions & personal pools</summary><div className="guide-detail-body"><Screen name="candidates" alt="Champion selector with role icons, popularity sorting and multiple selected candidates"/><div><p>The matching role and <b>popularity</b> are selected by default. Use the five role icons to change the filter; click the active role to show all champions. The two sort icons switch between alphabetical order and popularity.</p><p>Your personal pool loads when you take a role. Moving away clears your candidates from the vacated role. Room edits only become personal defaults when you choose <b>Save pool</b>.</p></div></div></details>
   </section>
   <section className="guide-chapter" id="draft" aria-labelledby="draft-title">
    <div className="guide-chapter-heading"><span className="guide-number">03</span><div><h2 id="draft-title">Picks, bans and corrections</h2><p>The host chooses <b>Start draft</b>. The step banner and glowing panels show whose action is next. There is no timer.</p></div></div>
    <Screen name="draft" alt="Guided draft showing the red team's next picks, Undo and Redo, and the selected allied champion first"/>
    <div className="guide-two-notes"><p><b className="guide-pin">1</b><strong>One choice advances the draft.</strong> Select a ban or click a candidate to lock a pick. Ranked bans can be entered together in the selector.</p><p><b className="guide-pin">2</b><strong>The selected champion stays first.</strong> Other candidates are ordered by their current individual score. A non-host player controls their own pick; the host can manage all picks.</p></div>
    <div className="guide-gestures"><div><span aria-hidden="true">↔</span><p><strong>Move the role panel</strong>Change your role and take your champion with you. An occupied role requires the other player's agreement.</p></div><div><span aria-hidden="true">▣</span><p><strong>Move the portrait</strong>Move the champion only. Moves involving another player's pick may require their agreement.</p></div><div><span aria-hidden="true">↶</span><p><strong>Correct a choice</strong>The host can use <b>Undo / Redo</b> or <kbd>Ctrl Z</kbd> / <kbd>Ctrl Y</kbd>.</p></div></div>
    <details className="guide-detail"><summary>Open draft, Clear, lobby & leaving</summary><div className="guide-controls"><p><b>Open draft</b> removes the normal pick/ban order. To return to Guided draft, confirm a restart from zero.</p><p><b>Clear</b> resets picks and bans while keeping roles and candidate lists. <b>Return to lobby</b> resets the draft and returns everyone to preparation after confirmation.</p><p><b>Quit room</b> leaves the room personally; other participants can continue.</p></div></details>
   </section>
   <section className="guide-chapter" id="scores" aria-labelledby="scores-title">
    <div className="guide-chapter-heading"><span className="guide-number">04</span><div><h2 id="scores-title">Scores and team advantage</h2><p>Scores combine matchups against enemies and synergies with allies. Higher is more favorable for the team being evaluated.</p></div></div>
    <Screen name="scores" alt="The two signed team scores and the central advantage bar showing their difference"/>
    <div className="guide-two-notes"><p><b className="guide-pin">1</b><strong>Team score.</strong> Each team has its own signed score. Both can be positive, or both negative.</p><p><b className="guide-pin">2</b><strong>Team advantage.</strong> The central bar shows <b>ally score − enemy score</b>. The centre means equal scores; the label names the leading team.</p></div>
    <div className="guide-comparison"><Screen name="comparison" alt="Hover comparison distinguishing a champion's individual score from the team score change when replacing the current pick"/><div><h3>Compare a replacement</h3><p><b>Individual score</b> describes that champion's fit with the other selected champions.</p><p><b>Current team → With [champion]</b> previews the whole team's score after replacement. <b>Team score change</b> is the gain or loss compared with now.</p><div className="guide-aside">An enemy recommendation is favorable <b>for the enemy</b>. </div></div></div>
    <div className="guide-suggestions"><h3>Candidate suggestions</h3><p>Your candidates stay. Empty lists receive five popular available champions. <b>Show best fits</b> adds up to three eligible high-scoring options without duplicates. Non-empty lists receive no popularity fillers.</p><div className="guide-legend"><span><b>★</b> Best fit</span><span><b>✦</b> Popular fallback</span><span><i className="guide-fit-dot"/> Exceptional positive / negative fit</span></div><p className="guide-small">Suggestions update after picks and bans. Hover a highlighted champion to see the explanation.</p></div>
    <p className="guide-caution"><b>Scores are not win probabilities.</b> Scores combine both interaction directions, with fixed divisors of 9 per champion and 5 per team. Unrevealed champions and missing directions contribute zero. Scores remain provisional while the draft or data coverage is incomplete. <b>N/A</b> marks unavailable data, not an observed neutral interaction.</p>
   </section>
   <section className="guide-chapter" id="import" aria-labelledby="import-title">
    <div className="guide-chapter-heading"><span className="guide-number">05</span><div><h2 id="import-title">Import a screenshot</h2><p>The host can drop a champion-select screenshot onto the draft, choose a file, or paste with <kbd>Ctrl V</kbd> outside a text field.</p></div></div>
    <Screen name="import" alt="Screenshot import panel with drop area, Choose image button and clipboard instructions"/>
    <p className="guide-import-description">Detected selections are added directly and Open draft is enabled. Compatible existing picks, bans and role placements are kept. Conflicting screenshots are rejected. Correct roles or picks in the draft; one <b>Undo</b> removes the whole import, and Redo restores it.</p>
    <div className="guide-aside">Recognition runs on your device. Images are not uploaded. Uncertain portraits and in-progress picks are left out; crop to the client for faster recognition.</div>
   </section>
   <div className="guide-end"><a className="guide-back" href="#top">Back to top ↑</a></div>
   <footer className="guide-footer"><span>Draftroom · Visual user guide</span><p>Example screens; scores are illustrative and change with the draft. Select an image to view it full size.</p><small>Updated 17 November 2026</small></footer>
  </main>
 </div>;
}
