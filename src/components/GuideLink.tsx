import ExternalArrow from './ExternalArrow';
export default function GuideLink(){
 return <a className="guide-link" href="/guide" target="_blank" rel="noopener noreferrer" title="Open the visual user guide in a new tab">User guide <ExternalArrow/><span className="sr-only"> (opens in a new tab)</span></a>;
}
