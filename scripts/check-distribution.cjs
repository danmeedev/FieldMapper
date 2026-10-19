const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const removed=['CLAUDE.md','BUG-REVIEW.md','IMPLEMENTATION-PLAN.md','REVIEW-TESTING.md','UPDATE-REVIEW.md','mobile-app/INSTALL-ANDROID.md','.claude/','mobile-app/.idea/'];
const history=execFileSync('git',['log','--format=','--name-only','HEAD','--',...removed],{encoding:'utf8'}).trim();
assert.equal(history,'','Development documents must be absent from distribution history');
const docs=execFileSync('git',['ls-files','*.md'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
for(const file of docs)assert.ok(['README.md','QUICK-SETUP.md'].includes(file)||/(^|\/)(license|licence|notice|copying|third-party-notices)(\..*)?$/i.test(file),'Unexpected distribution document: '+file);
console.log('PASS distribution documents and history: user guides and legal notices only.');
