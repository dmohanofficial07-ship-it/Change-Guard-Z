import { useEffect, useState } from 'react';
import { Activity, Check, GitPullRequest, Pause, Play, RotateCcw, Volume2, VolumeX, Waypoints } from 'lucide-react';

const scenes = [
  {
    title: 'A change is proposed',
    caption: 'A pull request is a proposed code change. DiffHarbor checks it before your team merges.',
    narration: 'A pull request is a proposed code change. DiffHarbor checks it before your team merges.',
    visual: 'request',
  },
  {
    title: 'Check before and after',
    caption: 'The same configured checks run on the current version and the proposed version.',
    narration: 'The same configured checks run on the current version and the proposed version. DiffHarbor compares the results.',
    visual: 'compare',
  },
  {
    title: 'See what changed',
    caption: 'Review new failures, existing failures, fixes, and passes. Python changes also get an impact map.',
    narration: 'Review new failures, existing failures, fixes, and passes. Python changes also get an impact map.',
    visual: 'impact',
  },
  {
    title: 'Your team decides',
    caption: 'DiffHarbor reports evidence; your team decides what to do. It does not merge or deploy.',
    narration: 'DiffHarbor reports evidence. Your team decides what to do next. It does not merge or deploy.',
    visual: 'decision',
  },
];

function TuliMascot() {
  return (
    <div className="tuli-mascot" role="img" aria-label="Tuli, the DiffHarbor guide">
      <svg viewBox="0 0 112 126" aria-hidden="true">
        <path className="tuli-beam" d="M38 25 12 12v25l27-4M74 25l26-13v25l-27-4" />
        <path className="tuli-roof" d="M36 34h40L68 23H44z" />
        <rect className="tuli-window" x="40" y="35" width="32" height="17" rx="4" />
        <path className="tuli-body" d="m38 52-8 56h52l-8-56z" />
        <path className="tuli-stripe" d="M34 79h44l-3 13H32z" />
        <path className="tuli-base" d="M23 109h66l8 9H15z" />
        <circle className="tuli-eye" cx="48" cy="43" r="2.2" />
        <circle className="tuli-eye" cx="64" cy="43" r="2.2" />
        <path className="tuli-smile" d="M49 48q7 6 14 0" />
        <circle className="tuli-glow" cx="56" cy="28" r="4" />
      </svg>
      <span>Tuli</span>
    </div>
  );
}

function SceneVisual({ visual }: { visual: string }) {
  if (visual === 'request') {
    return <div className="tuli-visual-card request-visual"><GitPullRequest size={25} /><div><strong>Pull request</strong><span>A proposed change</span></div><span className="visual-badge">Review</span></div>;
  }
  if (visual === 'compare') {
    return <div className="compare-visual">
      <div className="compare-branch"><span>Current version</span><strong><Check size={15} /> Tests run</strong></div>
      <div className="compare-connector"><span /><span /><span /></div>
      <div className="compare-branch candidate"><span>Proposed version</span><strong><Activity size={15} /> Same tests</strong></div>
    </div>;
  }
  if (visual === 'impact') {
    return <div className="tuli-visual-card impact-visual"><Waypoints size={24} /><div><strong>Impact map</strong><span>Python imports and routes</span></div><span className="visual-badge">Python</span></div>;
  }
  return <div className="tuli-visual-card decision-visual"><div className="decision-checks"><span><Check size={14} /> Pass</span><span className="decision-fail">! New failure</span><span><Check size={14} /> Fixed</span></div><div className="decision-person"><span>Team review</span><strong>Human decides</strong></div></div>;
}

export default function TuliExplainer() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [narration, setNarration] = useState(false);
  const scene = scenes[sceneIndex];

  useEffect(() => {
    if (!playing) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      return undefined;
    }

    if (narration && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(scene.narration);
      utterance.rate = 0.98;
      utterance.onend = () => {
        if (sceneIndex === scenes.length - 1) setPlaying(false);
        else setSceneIndex((current) => current + 1);
      };
      window.speechSynthesis.speak(utterance);
      return () => window.speechSynthesis.cancel();
    }

    const timeout = window.setTimeout(() => {
      if (sceneIndex === scenes.length - 1) setPlaying(false);
      else setSceneIndex((current) => current + 1);
    }, 6500);
    return () => window.clearTimeout(timeout);
  }, [playing, narration, sceneIndex, scene.narration]);

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (sceneIndex === scenes.length - 1) setSceneIndex(0);
    setPlaying(true);
  };

  return (
    <section className="tuli-explainer" aria-labelledby="tuli-title">
      <div className="tuli-explainer-heading">
        <div><span className="tuli-kicker">A SHORT WALKTHROUGH</span><h3 id="tuli-title">DiffHarbor in 30 seconds</h3></div>
        <span className="tuli-duration">4 simple steps</span>
      </div>
      <div className={`tuli-stage visual-${scene.visual}`} aria-live="polite">
        <TuliMascot />
        <div className="tuli-story">
          <span className="tuli-scene-count">0{sceneIndex + 1} / 0{scenes.length}</span>
          <h4>{scene.title}</h4>
          <p>{scene.caption}</p>
          <SceneVisual visual={scene.visual} />
        </div>
      </div>
      <div className="tuli-controls">
        <div className="tuli-progress" aria-label={`Step ${sceneIndex + 1} of ${scenes.length}`}>
          {scenes.map((item, index) => <button key={item.title} type="button" className={index === sceneIndex ? 'active' : index < sceneIndex ? 'done' : ''} aria-label={`Show step ${index + 1}: ${item.title}`} aria-current={index === sceneIndex ? 'step' : undefined} onClick={() => { setSceneIndex(index); setPlaying(false); }} />)}
        </div>
        <div className="tuli-buttons">
          <button className="tuli-play" type="button" onClick={togglePlayback}>{playing ? <Pause size={15} /> : sceneIndex === scenes.length - 1 ? <RotateCcw size={15} /> : <Play size={15} />}{playing ? 'Pause' : sceneIndex === scenes.length - 1 ? 'Replay' : 'Play guide'}</button>
          {'speechSynthesis' in window && <button className={`tuli-narration ${narration ? 'enabled' : ''}`} type="button" aria-pressed={narration} onClick={() => setNarration((enabled) => !enabled)}>{narration ? <Volume2 size={15} /> : <VolumeX size={15} />}{narration ? 'Voice on' : 'Voice off'}</button>}
        </div>
      </div>
      <p className="tuli-footnote">Python gets an impact map. Other stacks can run configured checks when their runtime is set up.</p>
    </section>
  );
}
