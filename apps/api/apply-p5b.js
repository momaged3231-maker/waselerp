const fs = require('fs');
const token = 'sbp_oauth_0528cf9fd6732fef458008c841e1c35af9de2d03';
const projectRef = 'lkrywkixijclebyjxxoo';

const sql = fs.readFileSync('C:/Users/moham/Downloads/waselerp-main/waselerp-main/db/migrations/2026-11-14-p5b.sql', 'utf8');

fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
})
  .then(r => r.text().then(t => ({ status: r.status, text: t })))
  .then(({ status, text }) => {
    console.log('Status:', status);
    console.log('Response:', text.slice(0, 500));
  })
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
