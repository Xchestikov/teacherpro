/* Verifies that every local app dependency is included in a VPS release.
   Run with: node tests/check-release-assets.js */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const sw=read('sw.js');
const workflow=read('.github/workflows/deploy-vps.yml');
const tags=[
  ...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']\.\/([^"']+)["']/g)
].map(match=>match[1].split(/[?#]/,1)[0]);
const shellSection=sw.match(/const SHELL=\[([\s\S]*?)\]\.map\(/);
assert.ok(shellSection,'Service Worker shell manifest was not found');
const cacheFiles=[...shellSection[1].matchAll(/'([^']*)'/g)].map(match=>match[1].split(/[?#]/,1)[0]).filter(Boolean);
const versionedFinance='finance-v3-core.js?v=20261019-46445603';
assert.ok(html.includes('./'+versionedFinance),'HTML must load revisioned finance script');
assert.ok(sw.includes("'"+versionedFinance+"'"),'Versioned finance script must be in offline shell');
assert.ok(sw.includes('SHELL_PATHS.has(url.pathname+url.search)'),'Service worker must handle revisioned shell URLs');
const required=new Set(['index.html',...tags,...cacheFiles]);
const releaseSection=workflow.match(/rsync -az[\s\S]*?(\n\s+index\.html [^\n]+)/);
assert.ok(releaseSection,'Versioned release upload line not found');
const releaseFiles=new Set(releaseSection[1].trim().replace(/\\\s*$/,'').split(/\s+/));
const validationSection=workflow.match(/for f in ([^;]+); do/);
assert.ok(validationSection,'Deploy validation file list not found');
const validatedFiles=new Set(validationSection[1].trim().split(/\s+/));
for(const file of required){
  assert.ok(fs.existsSync(path.join(root,file)), 'Missing referenced file: '+file);
  assert.ok(releaseFiles.has(file), 'Referenced asset omitted from VPS upload: '+file);
  assert.ok(validatedFiles.has(file), 'Referenced asset omitted from deploy validation: '+file);
}
console.log('OK: '+required.size+' app shell files are present, validated, and uploaded');
