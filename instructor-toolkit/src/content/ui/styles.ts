// Styles for everything the toolkit renders. They live inside a Shadow DOM, so
// Canvas CSS cannot leak in and toolkit CSS cannot leak out.

export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.tk {
  --tk-accent: #1F8A66;
  --tk-accent-strong: #163B32;
  --tk-accent-soft: #E7F6F0;
  --tk-text: #1F2933;
  --tk-muted: #5B6370;
  --tk-border: #D9DEE3;
  --tk-surface: #FFFFFF;
  --tk-surface-2: #F6F8F9;
  --tk-error: #B42318;
  --tk-error-soft: #FEF3F2;
  --tk-warning: #8A5A00;
  --tk-warning-soft: #FFF8E6;
  --tk-info: #175CD3;
  --tk-info-soft: #EFF4FF;
  font: 14px/1.45 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--tk-text);
}
.tk-launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  background: var(--tk-accent-strong); color: #fff; border: 0; border-radius: 999px;
  padding: 10px 16px; font: 600 14px/1 inherit; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
}
.tk-launcher:focus-visible, .tk button:focus-visible, .tk input:focus-visible, .tk select:focus-visible, .tk textarea:focus-visible {
  outline: 3px solid #8FD3B8; outline-offset: 2px;
}
.tk-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483001;
  width: min(760px, 100vw); background: var(--tk-surface); border-left: 1px solid var(--tk-border);
  box-shadow: -8px 0 24px rgba(0,0,0,.12); display: flex; flex-direction: column;
}
.tk-panel.narrow { width: min(420px, 100vw); }
.tk-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--tk-border); }
.tk-head h2 { font-size: 16px; margin: 0; flex: 1; }
.tk-tabs { display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--tk-border); }
.tk-tab { background: none; border: 0; border-bottom: 3px solid transparent; padding: 10px 8px; font: inherit; color: var(--tk-muted); cursor: pointer; }
.tk-tab[aria-selected="true"] { color: var(--tk-text); border-bottom-color: var(--tk-accent); font-weight: 600; }
.tk-body { flex: 1; overflow: auto; padding: 16px; }
.tk-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.tk-grow { flex: 1; }
.tk label { display: inline-flex; align-items: center; gap: 6px; }
.tk input[type=text], .tk input[type=number], .tk input[type=date], .tk input[type=time], .tk input[type=search], .tk select, .tk textarea {
  font: inherit; color: inherit; border: 1px solid var(--tk-border); border-radius: 6px; padding: 6px 8px; background: #fff;
}
.tk textarea { width: 100%; min-height: 90px; resize: vertical; }
.tk input[type=number] { width: 80px; }
.tk-btn { font: inherit; border-radius: 6px; padding: 7px 12px; border: 1px solid var(--tk-border); background: #fff; color: var(--tk-text); cursor: pointer; }
.tk-btn:disabled { opacity: .5; cursor: not-allowed; }
.tk-btn.primary { background: var(--tk-accent-strong); border-color: var(--tk-accent-strong); color: #fff; }
.tk-btn.danger { color: var(--tk-error); border-color: #F3B8B2; }
.tk-btn.small { padding: 3px 8px; font-size: 13px; }
.tk-icon { background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: var(--tk-muted); padding: 4px 8px; }
.tk-card { border: 1px solid var(--tk-border); border-radius: 8px; padding: 12px; margin-bottom: 12px; background: var(--tk-surface); }
.tk-card h3 { font-size: 14px; margin: 0 0 8px; }
.tk-muted { color: var(--tk-muted); font-size: 13px; }
.tk table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tk th, .tk td { text-align: left; padding: 6px; border-bottom: 1px solid var(--tk-border); vertical-align: top; }
.tk th { position: sticky; top: 0; background: var(--tk-surface-2); font-weight: 600; z-index: 1; }
.tk tr.module-row td { background: var(--tk-surface-2); font-weight: 600; }
.tk .changed { color: var(--tk-accent); font-weight: 600; }
.tk .was { text-decoration: line-through; color: var(--tk-muted); }
.tk-badge { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 12px; background: var(--tk-surface-2); border: 1px solid var(--tk-border); }
.tk-badge.error { background: var(--tk-error-soft); color: var(--tk-error); border-color: #F3B8B2; }
.tk-badge.warning { background: var(--tk-warning-soft); color: var(--tk-warning); border-color: #F5D58B; }
.tk-badge.info { background: var(--tk-info-soft); color: var(--tk-info); border-color: #B2CCFF; }
.tk-badge.ok { background: var(--tk-accent-soft); color: var(--tk-accent-strong); border-color: #A6DFC8; }
.tk-alert { border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; font-size: 13px; }
.tk-alert.error { background: var(--tk-error-soft); color: var(--tk-error); }
.tk-alert.warning { background: var(--tk-warning-soft); color: var(--tk-warning); }
.tk-alert.ok { background: var(--tk-accent-soft); color: var(--tk-accent-strong); }
.tk-progress { height: 6px; background: var(--tk-surface-2); border-radius: 999px; overflow: hidden; margin: 6px 0; }
.tk-progress > div { height: 100%; background: var(--tk-accent); transition: width .2s; }
.tk-list { list-style: none; margin: 0; padding: 0; }
.tk-list li { border-bottom: 1px solid var(--tk-border); padding: 8px 0; }
.tk-snippet { width: 100%; text-align: left; background: none; border: 0; padding: 6px 4px; border-radius: 6px; cursor: pointer; font: inherit; color: inherit; }
.tk-snippet:hover, .tk-snippet[aria-selected="true"] { background: var(--tk-accent-soft); }
.tk-criterion { border: 1px solid var(--tk-border); border-radius: 8px; padding: 8px; margin-bottom: 8px; }
.tk-criterion.focused { border-color: var(--tk-accent); box-shadow: 0 0 0 2px var(--tk-accent-soft); }
.tk-rating { display: inline-flex; gap: 4px; margin: 2px 4px 2px 0; padding: 2px 8px; border: 1px solid var(--tk-border); border-radius: 999px; background: #fff; cursor: pointer; font: inherit; font-size: 12px; }
.tk-rating.selected { background: var(--tk-accent-strong); color: #fff; border-color: var(--tk-accent-strong); }
.tk kbd { font: 12px ui-monospace, monospace; background: var(--tk-surface-2); border: 1px solid var(--tk-border); border-radius: 4px; padding: 0 4px; }
.tk-toast { position: fixed; bottom: 80px; right: 20px; z-index: 2147483002; background: var(--tk-text); color: #fff; padding: 10px 14px; border-radius: 8px; max-width: 360px; }
@media (max-width: 600px) { .tk-panel, .tk-panel.narrow { width: 100vw; } }
`
