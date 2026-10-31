import { useEffect, useState } from 'react';
import { Activity, ArrowRight, Check, GitPullRequest, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

const scenes = [
  {
    title: 'Meet Tuli',
    narration: 'Hi, I’m Tuli. Imagine you’re changing a backend service and you’re worried one small edit might break something else.',
    visual: 'intro',
  },
  {
    title: 'Rehearse the change',
    narration: 'DiffHarbor checks a proposed change before your team accepts it. It runs the same chosen checks on the current version and the proposed version, then compares the results.',
    visual: 'flow',
  },
  {
    title: 'Catch it, fix it',
    narration: 'In our demo, a score goes past its 100-point limit, and a test catches it. After the fix, the check passes. The dashboard shows new failures, existing failures, and fixes.',
    visual: 'results',
  },
  {
    title: 'See the likely impact',
    narration: 'Python projects also get a map of code that may be affected. Other languages can run configured checks when their runtime is set up, but don’t get an impact map yet.',
    visual: 'impact',
  },
  {
    title: 'Your team decides',
    narration: 'DiffHarbor doesn’t merge or deploy. Your team reviews the evidence and decides.',
    visual: 'decision',
  },
];

function Tuli({ speaking }: { speaking: boolean }) {
  return (
    <div className={`tuli-person ${speaking ? 'speaking' : ''}`} role="img" aria-label="Tuli, the DiffHarbor guide">
      <svg viewBox="0 0 140 180" aria-hidden="true">
        <ellipse className="person-shadow" cx="70" cy="166" rx="35" ry="7" />
        <path className="person-hair" d="M42 60c-5-28 10-44 30-44 24 0 34 19 27 45l-7 13H50z" />
        <path className="person-ear" d="M47 54c-11-5-13 12-2 17m50-17c11-5 13 12 2 17" />
        <ellipse className="person-face" cx="70" cy="58" rx="26" ry="31" />
        <path className="person-fringe" d="M44 50c2-22 15-33 31-31 12 1 20 9 22 23-10-1-17-7-22-15-7 10-18 17-31 18z" />
        <path className="person-brow" d="M55 57q5-4 10 0m11 0q5-4 10 0" />
        <circle className="person-eye" cx="60" cy="62" r="2" /><circle className="person-eye" cx="80" cy="62" r="2" />
        <path className="person-smile" d="M62 75q8 7 16 0" />
        <ellipse className="person-mouth-open" cx="70" cy="75" rx="4" ry="6" />
        <path className="person-neck" d="M60 86h20v17H60z" />
        <path className="person-shirt" d="M59 98 42 105l-8 48h72l-8-48-18-7-8 12z" />
        <path className="person-collar" d="m58 98 12 12 12-12-5-4H63z" />
        <path className="person-badge" d="m70 112 5 8-5 18-5-18z" />
        <path className="person-arm" d="M40 108 23 128l9 8 19-19m47-9 17 20-9 9-19-20" />
        <circle className="person-hand" cx="28" cy="135" r="6" /><circle className="person-hand" cx="112" cy="137" r="6" />
        <path className="person-pants" d="M44 151h23l-3 15H46zm29 0h23l-2 15H75z" />
        <path className="person-shoe" d="M44 164h20q4 0 4 5H40q0-4 4-5m33 0h19q4 0 4 5H74q0-4 3-5" />
      </svg>
      <span>Tuli</span>
    </div>
  );
}

function IntroVisual() {
  return <div className="cartoon-visual intro-visual">
    <div className="code-window"><div className="window-dots"><i /><i /><i /></div><span className="code-line blue" /><span className="code-line short" /><span className="code-line violet" /><span className="code-line" /><span className="code-line short blue" /></div>
    <div className="worry-bubble">Will this break something?</div>
    <span className="bug-mark">!</span>
  </div>;
}

function FlowVisual() {
  return <div className="cartoon-visual flow-visual">
    <div className="flow-card pull-card"><GitPullRequest size={21} /><strong>Proposed change</strong><span>Pull request</span></div>
    <div className="flow-arrow"><ArrowRight size={18} /><span>rehearse</span></div>
    <div className="flow-runners"><div><span>Current</span><Check size={15} /></div><div><span>Proposed</span><Activity size={15} /></div></div>
    <span className="flow-compare">Compare checks</span>
  </div>;
}

function ResultsVisual() {
  return <div className="cartoon-visual results-visual">
    <div className="score-card"><span>Risk score</span><div className="score-bar"><i /></div><strong>104 <small>/ 100</small></strong><span className="result-failed">New failure · limit exceeded</span></div>
    <ArrowRight className="fix-arrow" size={21} />
    <div className="score-card fixed"><span>After the fix</span><div className="score-bar"><i /></div><strong>98 <small>/ 100</small></strong><span className="result-passed"><Check size={12} /> Check passes</span></div>
  </div>;
}

function ImpactVisual() {
  return <div className="cartoon-visual impact-visual">
    <div className="map-graphic"><span className="map-node main-node">changed</span><i /><span className="map-node">module</span><i /><span className="map-node route-node">API route</span></div>
    <div className="language-pills"><span className="python-pill">Python · impact map</span><span>Other stacks · checks</span></div>
  </div>;
}

function DecisionVisual() {
  return <div className="cartoon-visual decision-visual">
    <div className="evidence-card"><strong><Check size={14} /> Evidence ready</strong><span>Results for a person to review</span><div className="human-decision"><span className="human-avatar">You</span><b>Team decides</b></div></div>
    <div className="not-automatic"><span>Merge</span><span>Deploy</span><b>Not automatic</b></div>
  </div>;
}

function SceneArt({ scene }: { scene: string }) {
  switch (scene) {
    case 'intro': return <IntroVisual />;
    case 'flow': return <FlowVisual />;
    case 'results': return <ResultsVisual />;
    case 'impact': return <ImpactVisual />;
    default: return <DecisionVisual />;
  }
}

export default function TuliExplainer() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [narration, setNarration] = useState(true);
  const scene = scenes[sceneIndex];
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (!playing) {
      if (speechAvailable) window.speechSynthesis.cancel();
      return undefined;
    }

    if (narration && speechAvailable) {
      const utterance = new SpeechSynthesisUtterance(scene.narration);
      utterance.rate = 0.96;
      utterance.pitch = 1.02;
      const voices = window.speechSynthesis.getVoices();
      const englishVoice = voices.find((voice) => /^en(-|_)/i.test(voice.lang) && /natural|online|neural/i.test(voice.name))
        ?? voices.find((voice) => /^en(-|_)/i.test(voice.lang));
      if (englishVoice) utterance.voice = englishVoice;
      utterance.onend = () => {
        if (sceneIndex === scenes.length - 1) setPlaying(false);
        else setSceneIndex((current) => current + 1);
      };
      utterance.onerror = () => {
        if (sceneIndex === scenes.length - 1) setPlaying(false);
        else setSceneIndex((current) => current + 1);
      };
      window.speechSynthesis.speak(utterance);
      return () => window.speechSynthesis.cancel();
    }

    const timeout = window.setTimeout(() => {
      if (sceneIndex === scenes.length - 1) setPlaying(false);
      else setSceneIndex((current) => current + 1);
    }, 7200);
    return () => window.clearTimeout(timeout);
  }, [playing, narration, sceneIndex, scene.narration, speechAvailable]);

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
        <div><span className="tuli-kicker">A SHORT ANIMATED EXPLAINER</span><h3 id="tuli-title">How DiffHarbor works</h3></div>
        <span className="tuli-duration">About 50 seconds</span>
      </div>
      <div className={`tuli-film scene-${scene.visual} ${playing ? 'is-playing' : ''}`} aria-live="polite">
        <Tuli speaking={playing && narration && speechAvailable} />
        <div className="film-story">
          <div className="film-art"><SceneArt scene={scene.visual} /></div>
          <div className="film-copy">
            <span className="tuli-scene-count">SCENE 0{sceneIndex + 1} / 0{scenes.length}</span>
            <h4>{scene.title}</h4>
            <p>{scene.narration}</p>
          </div>
        </div>
      </div>
      <div className="tuli-controls">
        <div className="tuli-progress" aria-label={`Scene ${sceneIndex + 1} of ${scenes.length}`}>
          {scenes.map((item, index) => <button key={item.title} type="button" className={index === sceneIndex ? 'active' : index < sceneIndex ? 'done' : ''} aria-label={`Show scene ${index + 1}: ${item.title}`} aria-current={index === sceneIndex ? 'step' : undefined} onClick={() => { setSceneIndex(index); setPlaying(false); }} />)}
        </div>
        <div className="tuli-buttons">
          <button className="tuli-play" type="button" onClick={togglePlayback}>{playing ? <Pause size={15} /> : sceneIndex === scenes.length - 1 ? <RotateCcw size={15} /> : <Play size={15} />}{playing ? 'Pause explainer' : sceneIndex === scenes.length - 1 ? 'Replay' : 'Play explainer'}</button>
          {speechAvailable && <button className={`tuli-narration ${narration ? 'enabled' : ''}`} type="button" aria-pressed={narration} onClick={() => { setPlaying(false); setNarration((enabled) => !enabled); }}>{narration ? <Volume2 size={15} /> : <VolumeX size={15} />}{narration ? 'Narration on' : 'Narration off'}</button>}
        </div>
      </div>
      <p className="tuli-footnote">Captions are included. Narration uses a voice available in your browser and may sound different between devices.</p>
    </section>
  );
}
