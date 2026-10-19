#!/usr/bin/env node
// Per-machine setup for this repo's Launchpad tooling (decisions/0082 W1, W4).
//
//   node launchpad/scripts/setup.mjs [--dry-run] [--harness claude|other] [--sf-skills plugin|skills]
//
// Installs the Salesforce CLI and the build toolkits the team picked, recorded as
// `toolkits` in the repo profile (.launchpad/repo.json). Each toolkit installs
// its own skills, so nothing here lands in the repo:
//   sf-pi       Pi with sf-pi (its /sf-skills command picks what loads)
//   sf-skills   forcedotcom/sf-skills, per agent (decisions/0085): Claude Code gets
//               the salesforce-development plugin from the `salesforce` marketplace,
//               on for this repo only (--scope local); the other agents found on the
//               machine get the skills via npx, globally. `salesforce` is an older name.
//               `sf_skills: "skills"` in the repo profile gives Claude Code the plain
//               skills instead (every folder, no plugin). A builder overrides the
//               repo with --sf-skills plugin|skills, remembered in the never-committed
//               .launchpad/local.json.
//   meshmesh    nothing to install: MeshMesh brings its own skills
// With no `toolkits` recorded it installs sf-pi and sf-skills.
//
// When the profile sets commit_skills: false the ql-* skills aren't in the repo
// (decisions/0072), so setup installs them, unless the Claude plugin is installed
// and already serves them (a second copy shows every skill twice). --harness
// overrides the detection. Zero-dep: bare node, nothing to npm install.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, renameSync, lstatSync, unlinkSync, realpathSync, statSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_CLI = 'skills@1.5.25';
const LAUNCHPAD_SKILLS = 'https://git.soma.salesforce.com/dgerow/quantum-leap-launchpad.git';
const NODE_MIN = [22, 20];
const TOOLKITS = ['sf-pi', 'sf-skills', 'salesforce', 'meshmesh'];
const ALIASES = { salesforce: 'sf-skills' };
const DEFAULT_TOOLKITS = ['sf-pi', 'sf-skills'];
const SF_SOURCE = 'forcedotcom/sf-skills';
// npx gets the full URL: the skills CLI resolves owner/repo shorthand against GH_HOST,
// which many Salesforce builders point at git.soma. (The Claude marketplace add isn't affected.)
const SF_SKILLS_URL = `https://github.com/${SF_SOURCE}`;
// The lock records a github.com install as owner/repo; accept the URL forms too.
const isSfSource = (src) => typeof src === 'string'
  && src.toLowerCase().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '').replace(/\.git$/, '') === SF_SOURCE;
// Git for Windows hits MAX_PATH on sf-skills' deep tree: turn on long paths for that
// clone only, appended to any GIT_CONFIG_* pairs already set.
function longPathsEnv() {
  if (process.platform !== 'win32') return undefined;
  const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
  return { ...process.env, GIT_CONFIG_COUNT: String(n + 1), [`GIT_CONFIG_KEY_${n}`]: 'core.longpaths', [`GIT_CONFIG_VALUE_${n}`]: 'true' };
}
const SF_PLUGIN = 'salesforce-development@salesforce';
// The agents besides Claude Code that npx gets sf-skills for, each named only when
// its home dir is here (the same test the skills CLI uses). Naming them keeps npx
// out of Claude Code, where the plugin serves the skills.
const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const OTHER_AGENTS = {
  codex: () => process.env.CODEX_HOME || join(homedir(), '.codex'),
  cursor: () => join(homedir(), '.cursor'),
  opencode: () => join(configHome(), 'opencode'),
  'github-copilot': () => join(homedir(), '.copilot'),
  'gemini-cli': () => join(homedir(), '.gemini'),
  windsurf: () => join(homedir(), '.codeium', 'windsurf'),
};

function profile() {
  for (const file of ['repo.json', 'engagement.json']) {
    try { return JSON.parse(readFileSync(join(ROOT, '.launchpad', file), 'utf8')); } catch { /* not this file */ }
  }
  return {};
}

// Per-machine, gitignored state (also holds the active engagement and source paths).
const LOCAL_FILE = join(ROOT, '.launchpad', 'local.json');
function readLocal() {
  try { return JSON.parse(readFileSync(LOCAL_FILE, 'utf8')); } catch (e) { return e.code === 'ENOENT' ? {} : null; }
}

// Remember this builder's --sf-skills choice. Merge-and-write; never touch a file we can't parse.
function rememberSfChoice(mode) {
  const local = readLocal();
  if (!local || typeof local !== 'object' || Array.isArray(local)) return `Couldn't remember --sf-skills ${mode}: .launchpad/local.json isn't readable JSON. Pass the flag on each run.`;
  if (local.sf_skills === mode) return '';
  mkdirSync(dirname(LOCAL_FILE), { recursive: true });
  writeFileSync(LOCAL_FILE, JSON.stringify({ ...local, sf_skills: mode }, null, 2) + '\n');
  return `Remembered --sf-skills ${mode} for this machine (.launchpad/local.json).`;
}

const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

function pluginEntries() {
  try {
    return JSON.parse(readFileSync(join(claudeConfigDir(), 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {};
  } catch { return {}; }
}
const installedPlugins = () => Object.keys(pluginEntries());

const pluginInstalled = () => installedPlugins().some((k) => k.startsWith('quantum-leap-launchpad@'));

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

// Installed for this repo: user-wide, or a local/project install recorded for this path.
function sfInstalledHere() {
  const entries = pluginEntries()[SF_PLUGIN];
  if (!Array.isArray(entries)) return false;
  return entries.some((e) => !e?.scope || e.scope === 'user' || (e.projectPath && real(e.projectPath) === real(ROOT)));
}

// Enabled here: the most specific settings file that names it wins (local, project, user).
function sfEnabledHere() {
  if (!sfInstalledHere()) return false;
  for (const file of [join(ROOT, '.claude', 'settings.local.json'), join(ROOT, '.claude', 'settings.json'), join(claudeConfigDir(), 'settings.json')]) {
    try {
      const v = JSON.parse(readFileSync(file, 'utf8')).enabledPlugins?.[SF_PLUGIN];
      if (typeof v === 'boolean') return v;
    } catch { /* absent or unreadable */ }
  }
  return true;
}

const readSettings = () => JSON.parse(readFileSync(join(claudeConfigDir(), 'settings.json'), 'utf8'));

// The /plugin auto-update toggle writes this same field. Set it only when absent, so
// a builder who turned it off stays off. Parse-and-merge; never touch a file we can't
// parse. Writes through a symlinked settings file and keeps its mode (it can hold keys).
function enableAutoUpdate() {
  const manual = 'Turn on auto-update in Claude Code: `/plugin` → Marketplaces → salesforce.';
  let settings, target;
  try { target = realpathSync(join(claudeConfigDir(), 'settings.json')); settings = readSettings(); } catch { return manual; }
  const entry = settings?.extraKnownMarketplaces?.salesforce;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return manual;
  if ('autoUpdate' in entry) return entry.autoUpdate === true ? '' : 'Auto-update for the `salesforce` marketplace is off; left off, as you set it.';
  entry.autoUpdate = true;
  const tmp = `${target}.ql-tmp`;
  try {
    const mode = statSync(target).mode & 0o777;
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode });
    chmodSync(tmp, mode); // the umask can narrow or widen what writeFileSync set
    renameSync(tmp, target);
  } catch {
    try { unlinkSync(tmp); } catch { /* never created */ }
    return manual;
  }
  return 'Turned on auto-update for the `salesforce` marketplace.';
}

// An earlier setup let npx link sf-skills into Claude Code user-wide. Where the
// plugin is on for this repo, drop just those symlinks, so the skills don't show
// twice here; the copy under ~/.agents/skills stays for the other agents. Real
// directories are never touched. The lock path follows the skills CLI (XDG_STATE_HOME first).
function dropClaudeLinks() {
  if (!sfEnabledHere()) return '';
  const canon = real(join(homedir(), '.agents', 'skills'));
  const lockFile = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, 'skills', '.skill-lock.json')
    : join(homedir(), '.agents', '.skill-lock.json');
  let lock;
  try { lock = JSON.parse(readFileSync(lockFile, 'utf8')).skills || {}; } catch { return ''; }
  let dropped = 0;
  for (const [name, entry] of Object.entries(lock)) {
    if (!isSfSource(entry?.source) || !/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
    const link = join(claudeConfigDir(), 'skills', name);
    try {
      // Real paths on both sides: the skills CLI writes the link relative to the real link dir.
      if (!lstatSync(link).isSymbolicLink() || !realpathSync(link).startsWith(canon + sep)) continue;
      unlinkSync(link);
      dropped += 1;
    } catch { /* absent or unreadable: not ours */ }
  }
  return dropped
    ? `Removed ${dropped} Claude Code link${dropped === 1 ? '' : 's'} to npx sf-skills; the ${SF_PLUGIN} plugin serves them in this repo. To have them in every folder: \`claude plugin install ${SF_PLUGIN}\`.`
    : '';
}

// The local install's switch lives in .claude/settings.local.json, which is per machine.
// Claude Code doesn't add it to the repo's .gitignore, so setup does when git would track it.
function ignoreLocalSettings() {
  const file = '.claude/settings.local.json';
  if (!existsSync(join(ROOT, file))) return ''; // a user-wide install writes none
  const git = (args) => spawnSync('git', args, { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' }).status;
  // --no-index: ask whether a rule matches, even if the file is already tracked.
  const ignored = git(['check-ignore', '-q', '--no-index', file]);
  if (ignored !== 0 && ignored !== 1) return ''; // not a git repo, or no git
  const lines = [];
  if (ignored === 1) {
    const gi = join(ROOT, '.gitignore');
    const body = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    const eol = body.includes('\r\n') ? '\r\n' : '\n';
    appendFileSync(gi, `${body && !body.endsWith('\n') ? eol : ''}# Per-machine Claude Code settings (never tracked).${eol}${file}${eol}`);
    lines.push(`Added ${file} to .gitignore; commit that.`);
  }
  if (git(['ls-files', '--error-unmatch', file]) === 0) lines.push(`${file} is tracked, so git still commits it: run \`git rm --cached ${file}\` and commit.`);
  return lines.join(' ');
}

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const harness = flag('--harness');
if (harness !== null && !['claude', 'other'].includes(harness)) { console.error('--harness claude|other'); process.exit(2); }
const SF_MODES = ['plugin', 'skills'];
const sfFlag = flag('--sf-skills');
if (sfFlag !== null && !SF_MODES.includes(sfFlag)) { console.error('--sf-skills plugin|skills'); process.exit(2); }

const p = profile();
const raw = Array.isArray(p.toolkits) ? p.toolkits : DEFAULT_TOOLKITS;
const unknown = raw.filter((t) => !TOOLKITS.includes(t));
if (unknown.length) { console.error(`.launchpad/repo.json toolkits: unknown ${unknown.join(', ')} (known: ${TOOLKITS.join(', ')}).`); process.exit(2); }
const picked = [...new Set(raw.map((t) => ALIASES[t] || t))];
if (p.sf_skills !== undefined && !SF_MODES.includes(p.sf_skills)) { console.error(`.launchpad/repo.json sf_skills: ${SF_MODES.join(' or ')}, not ${JSON.stringify(p.sf_skills)}.`); process.exit(2); }
// How Claude Code gets sf-skills: this run's flag, then this builder's remembered
// choice, then the repo's recommendation, then the plugin.
const remembered = readLocal()?.sf_skills;
const sfMode = sfFlag ?? (SF_MODES.includes(remembered) ? remembered : p.sf_skills ?? 'plugin');

const steps = [['npm', ['install', '-g', '@salesforce/cli', ...(picked.includes('sf-pi') ? ['@earendil-works/pi-coding-agent'] : [])]]];
const actions = []; // [label, run]: in-process, after every step succeeds; run returns a line to print or ''
const after = [];
if (picked.includes('sf-pi')) {
  steps.push(['pi', ['install', 'git:github.com/salesforce/sf-pi']]);
  after.push('In Pi, run `/sf-skills defaults install`, then `/sf-skills toggle` to pick what loads.');
}
if (picked.includes('sf-skills')) {
  const claude = harness !== 'other'
    && spawnSync('claude', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  const plugin = claude && sfMode === 'plugin';
  if (plugin) {
    steps.push(['claude', ['plugin', 'marketplace', 'add', SF_SOURCE]]);
    // Reinstalling re-enables a plugin the builder disabled, so leave an installed one alone.
    if (sfInstalledHere()) after.push(`${SF_PLUGIN} is already installed for this repo; left as it is.`);
    else steps.push(['claude', ['plugin', 'install', SF_PLUGIN, '--scope', 'local']]);
    actions.push(['Add .claude/settings.local.json to .gitignore (if git would track it)', ignoreLocalSettings]);
    actions.push(['Turn on auto-update for the `salesforce` marketplace (if unset)', enableAutoUpdate]);
    after.push('More Salesforce plugins are in the `salesforce` marketplace: run `/plugin` in Claude Code. To use plain skills in Claude Code instead, re-run with `--sf-skills skills`.');
  } else if (claude) {
    after.push('Claude Code gets sf-skills as plain skills on this machine, in every folder. For the plugin instead: `--sf-skills plugin`.');
    if (sfEnabledHere()) after.push(`The ${SF_PLUGIN} plugin is still on for this repo, so its skills show twice: \`claude plugin disable ${SF_PLUGIN}\`.`);
  } else if (harness === 'claude') {
    after.push(`No Claude CLI here, so the ${SF_PLUGIN} plugin wasn't installed. In Claude Code, from this repo: \`/plugin marketplace add ${SF_SOURCE}\`, then \`/plugin install ${SF_PLUGIN}\` with local scope.`);
  }
  const agents = harness === 'claude' ? [] : Object.keys(OTHER_AGENTS).filter((a) => existsSync(OTHER_AGENTS[a]()));
  if (claude && !plugin) agents.unshift('claude-code');
  if (agents.length) steps.push(['npx', ['-y', SKILLS_CLI, 'add', SF_SKILLS_URL, '-g', '-a', ...agents, '--yes'], longPathsEnv()]);
  else if (harness !== 'claude') after.push(`No other agent found here (${Object.keys(OTHER_AGENTS).join(', ')}), so sf-skills wasn't installed for one. For another agent: \`npx ${SKILLS_CLI} add ${SF_SKILLS_URL} -g -a <agent>\`.`);
  // Also under --harness claude: links left by an earlier npx run still show the skills twice.
  if (plugin) actions.push(['Drop Claude Code links to npx sf-skills (the plugin serves them)', dropClaudeLinks]);
}
if (sfFlag) actions.push([`Remember --sf-skills ${sfFlag} for this machine`, () => rememberSfChoice(sfFlag)]);

let skipNote = '';
if (p.commit_skills === false) {
  const plugin = harness ? harness === 'claude' : pluginInstalled();
  if (plugin) skipNote = 'The ql-* skills come from the quantum-leap-launchpad plugin here, so none are installed. On another harness, re-run with --harness other.';
  else steps.push(['npx', ['-y', SKILLS_CLI, 'add', LAUNCHPAD_SKILLS, '--yes']]);
}

if (argv.includes('--dry-run')) {
  for (const [cmd, args] of steps) console.log([cmd, ...args].join(' '));
  for (const line of [skipNote, ...actions.map(([label]) => label), ...after].filter(Boolean)) console.log(`# ${line}`);
  process.exit(0);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < NODE_MIN[0] || (major === NODE_MIN[0] && minor < NODE_MIN[1])) {
  console.error(`Node ${NODE_MIN.join('.')} or newer is needed; this is ${process.versions.node}.`);
  process.exit(1);
}

for (const [cmd, args, env] of steps) {
  console.log(`\n▶ ${[cmd, ...args].join(' ')}`);
  // npm, npx and pi are .cmd shims on Windows, which need a shell to run.
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...(env ? { env } : {}) });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} failed${r.error ? `: ${r.error.message}` : ''}. Fix it and re-run; finished steps are safe to repeat.`);
    process.exit(r.status || 1);
  }
}
for (const [label, act] of actions) {
  let line;
  try { line = act(); } catch { line = `Couldn't ${label.charAt(0).toLowerCase()}${label.slice(1)}; the installs above are done.`; }
  if (line) after.unshift(line);
}
console.log('\n✓ Setup done.');
for (const line of [skipNote, ...after].filter(Boolean)) console.log(`  ${line}`);
