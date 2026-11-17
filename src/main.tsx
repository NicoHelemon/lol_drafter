import React,{lazy,Suspense} from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
const App=lazy(()=>import('./App'));
const UserGuide=lazy(()=>import('./pages/UserGuide'));
const guide=/^\/guide\/?$/.test(location.pathname);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<main className="guide-loading">Opening {guide?'the guide':'Draftroom'}…</main>}>{guide?<UserGuide/>:<App/>}</Suspense></React.StrictMode>);
