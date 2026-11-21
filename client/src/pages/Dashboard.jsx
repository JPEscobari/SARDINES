import { useEffect, useRef, useState } from 'react';
import { Theme, Header, HeaderName, HeaderMenuButton, SideNav, SideNavItems, SideNavLink, SkipToContent } from '@carbon/react';
import { Home, ChatBot, Task, Chat, Activity, Connect } from '@carbon/icons-react';
import { parseRoute, routeHref } from '../app/navigation';
import Overview from './Overview';
import ActivityPage from './Activity';
import Integrations from './Integrations';
import Legacy from './Legacy';
import SardinesAssistant from '../components/SardinesAssistant';
import PromiseQueue from '../components/PromiseQueue';
import ActionReview from '../components/ActionReview';
import './Dashboard.css';
const navigation = [
  ['overview', 'Overview', Home, 'Your commitments, connected.'],
  ['analyze', 'SARDINES Assistant', ChatBot, 'Ask anything or paste meeting notes and emails — SARDINES handles the rest.'],
  ['promises', 'Promises', Task, 'A Promise is a commitment to a customer. Review the evidence before updating it.'],
  ['follow-ups', 'Follow-ups', Chat, 'Review an internal action, prepare a message, and track the response.'],
  ['activity', 'Activity', Activity, 'A read-only history of saved sources, reviews and follow-ups.'],
  ['integrations', 'Integrations', Connect, 'Understand what is available and what still needs a connection.'],
];
export default function Dashboard() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const title = useRef(null);
  useEffect(() => {
    const change = () => { setRoute(parseRoute(window.location.hash)); setOpen(false); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => { title.current?.focus(); document.title = `${navigation.find(n => n[0] === route.page)?.[1] || 'Legacy Prototype'} | SARDINES`; }, [route.page]);
  const current = navigation.find(n => n[0] === route.page) || ['legacy', 'Legacy Prototype', null, 'Original MongoDB prototype, preserved separately.'];
  const changed = () => setRevision(r => r + 1);
  const screens = { overview: <Overview key={revision} />, promises: <PromiseQueue refreshKey={revision} selectedId={route.id} />, 'follow-ups': <ActionReview refreshKey={revision} onChanged={changed} selectedId={route.id} />, activity: <ActivityPage />, integrations: <Integrations />, legacy: <Legacy /> };
  return <Theme theme="g10"><div className="app-shell">
    <Theme theme="g100"><Header aria-label="SARDINES"><SkipToContent href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }} /><HeaderMenuButton aria-label="Toggle navigation" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(v => !v)} isActive={open} /><HeaderName href={routeHref('overview')} prefix="">SARDINES<span className="brand-divider"> / </span><span className="brand-caption">Sales operations</span></HeaderName><span className="header-environment">IBM SkillsBuild · Local demo</span></Header></Theme>
    <SideNav id="workspace-navigation" aria-label="Primary navigation" expanded={open} isPersistent onOverlayClick={() => setOpen(false)} onSideNavBlur={() => setOpen(false)}>
      <div className="nav-caption">WORKSPACE</div><SideNavItems>{navigation.map(([page, label, icon]) => <SideNavLink key={page} href={routeHref(page)} renderIcon={icon} isActive={route.page === page} aria-current={route.page === page ? 'page' : undefined}>{label}</SideNavLink>)}</SideNavItems>
      <div className="nav-footnote"><strong>Built for follow-through.</strong><p>AI suggests. People review.</p><a href={routeHref('integrations')}>Integration status →</a></div>
    </SideNav>
    <main id="main-content" className="workspace" tabIndex={-1}><div className="page-heading"><p className="eyebrow">SARDINES / WORKSPACE</p><h1 ref={title} tabIndex={-1}>{current[1]}</h1><p>{current[3]}</p></div>
      {/* Keep the Assistant mounted: navigation never loses conversation state. */}
      <div hidden={route.page !== 'analyze'}><SardinesAssistant onSaved={changed} /></div>
      {screens[route.page]}
      <footer className="workspace-footer">A saved review is not business approval. External operations require separate authorization.</footer>
    </main>
  </div></Theme>;
}
