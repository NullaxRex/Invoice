const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway provides a persistent volume at /data, fall back to local db/
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'collision.db'));

// ── Schema ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    customer TEXT NOT NULL,
    insurance TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    parts TEXT NOT NULL,
    labor TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Estimate',
    tech TEXT DEFAULT '',
    target TEXT DEFAULT '',
    estimate REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    flags TEXT NOT NULL DEFAULT '[]',
    audit_log TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// ── Seed data if empty ────────────────────────────────────────────────────
const count = db.prepare('SELECT COUNT(*) as n FROM jobs').get();
if (count.n === 0) {
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO jobs
    (id,date,customer,insurance,vehicle,parts,labor,status,tech,target,estimate,notes,flags,audit_log,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  insert.run(
    'JOB-0001','3/29/2026',
    JSON.stringify({name:'Maria Garcia',phone:'555-201-0001',email:'maria@example.com'}),
    JSON.stringify({company:'State Farm',claim:'SF-2026-0441',adjuster:'Tom Willis'}),
    JSON.stringify({year:'2021',make:'Honda',model:'Accord',color:'Pearl White',vin:'1HGCV1F3XLA025410',damageLevel:'Moderate',damage:'Front bumper, hood, and grille damage from front-end collision.'}),
    JSON.stringify([{desc:'Front Bumper Assembly',partNo:'HND-FB-21',qty:1,price:520},{desc:'Hood Panel',partNo:'HND-HP-21',qty:1,price:890}]),
    JSON.stringify([{desc:'Bumper R&R',hours:2.5,rate:95},{desc:'Hood Replacement & Align',hours:4,rate:95}]),
    'Estimate','','',0,'','[]',
    JSON.stringify([{ts:'3/29/2026 8:00 AM',user:'Shop Admin',action:'Estimate created',detail:''}]),
    now,now
  );
  insert.run(
    'JOB-0002','3/25/2026',
    JSON.stringify({name:'Brian Tran',phone:'',email:'b.tran@example.com'}),
    JSON.stringify({company:'Geico',claim:'GC-29017',adjuster:'Lisa Park'}),
    JSON.stringify({year:'2020',make:'Honda',model:'Pilot',color:'Blue',vin:'5FNYF6H92LB123789',damageLevel:'Moderate',damage:'Rear quarter panel, bumper cover, and trunk lid from parking lot collision.'}),
    JSON.stringify([{desc:'Quarter Panel RH',partNo:'HND-QP-20',qty:1,price:680},{desc:'Bumper Cover Rear',partNo:'HND-BC-20A',qty:1,price:290},{desc:'Trunk Lid',partNo:'HND-TL-20',qty:1,price:540}]),
    JSON.stringify([{desc:'Paint & Blend',hours:6,rate:95},{desc:'Alignment Check',hours:1,rate:115}]),
    'In Progress','','2026-03-28',2800,'Customer requested OEM trunk lid','[]',
    JSON.stringify([{ts:'3/25/2026 10:05 AM',user:'Shop Admin',action:'Estimate created',detail:''}]),
    now,now
  );
  insert.run(
    'JOB-0003','3/20/2026',
    JSON.stringify({name:'Sandra Williams',phone:'(832)555-0442',email:'swilliams@example.com'}),
    JSON.stringify({company:'Allstate',claim:'AL-67320',adjuster:'Rick Owens'}),
    JSON.stringify({year:'2019',make:'Ford',model:'F-150',color:'White',vin:'1FTEW1EG0KFA12345',damageLevel:'Minor',damage:'Driver side door, mirror, and rocker panel scraped in sideswipe.'}),
    JSON.stringify([{desc:'Door Shell LH',partNo:'FRD-DS-19',qty:1,price:750},{desc:'Mirror LH w/ Camera',partNo:'FRD-MR-19',qty:1,price:440}]),
    JSON.stringify([{desc:'Paint & Blend',hours:5,rate:95},{desc:'PDR Door Ding',hours:1,rate:150}]),
    'Awaiting Parts','J. Rivera','2026-03-20',2600,'OEM mirror backordered','[]',
    JSON.stringify([{ts:'3/20/2026 2:30 PM',user:'Shop Admin',action:'Estimate created',detail:''}]),
    now,now
  );
  console.log('Seeded 3 demo jobs');
}

// ── Helpers ───────────────────────────────────────────────────────────────
function rowToJob(r) {
  return {
    id: r.id, date: r.date,
    customer: JSON.parse(r.customer),
    insurance: JSON.parse(r.insurance),
    vehicle: JSON.parse(r.vehicle),
    parts: JSON.parse(r.parts),
    labor: JSON.parse(r.labor),
    status: r.status, tech: r.tech, target: r.target,
    estimate: r.estimate, notes: r.notes,
    flags: JSON.parse(r.flags),
    auditLog: JSON.parse(r.audit_log),
    created_at: r.created_at, updated_at: r.updated_at
  };
}

const WARN_PCT = 0.10;
const CRIT_PCT = 0.20;

function runFlags(job) {
  const t = new Date().toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  const active = [];
  const miss = [];
  if (!job.customer.name) miss.push('customer name');
  if (!job.customer.phone) miss.push('phone');
  if (!job.vehicle.vin) miss.push('VIN');
  if (!job.vehicle.damage) miss.push('damage description');
  if (!job.parts.length && !job.labor.length) miss.push('parts or labor');
  if (!job.tech) miss.push('technician');
  if (miss.length) active.push({type:'MISSING INFO',sev:'critical',msg:'Missing: '+miss.join(', '),ts:t,status:'active'});

  const pt = job.parts.reduce((a,p)=>a+(+p.qty||0)*(+p.price||0),0);
  const lt = job.labor.reduce((a,l)=>a+(+l.hours||0)*(+l.rate||0),0);
  const gt = pt + lt;

  if (job.estimate > 0) {
    const d = (gt - job.estimate) / job.estimate;
    if (d > CRIT_PCT) active.push({type:'PRICE VARIANCE',sev:'critical',msg:`Total $${gt.toFixed(0)} exceeds estimate by ${(d*100).toFixed(0)}% — critical`,ts:t,status:'active'});
    else if (d > WARN_PCT) active.push({type:'PRICE VARIANCE',sev:'warning',msg:`Total $${gt.toFixed(0)} exceeds estimate by ${(d*100).toFixed(0)}%`,ts:t,status:'active'});
  }
  if (job.target && job.status !== 'Closed' && job.status !== 'Ready') {
    const td = new Date(job.target); const now = new Date(); now.setHours(0,0,0,0);
    if (td < now) active.push({type:'DELAYED JOB',sev:'warning',msg:`Past target date (${job.target})`,ts:t,status:'active'});
  }
  const prev = (job.flags||[]).filter(f => f.status !== 'active');
  job.flags = [...prev, ...active];
  if (active.length) job.auditLog.push({ts:t,user:'Shop Admin',action:'Flags raised',detail:active.map(f=>f.type).join(', ')});
  return job;
}

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────

// GET all jobs
app.get('/api/jobs', (req, res) => {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
  res.json(rows.map(rowToJob));
});

// GET single job
app.get('/api/jobs/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({error:'Not found'});
  res.json(rowToJob(row));
});

// POST create job
app.post('/api/jobs', (req, res) => {
  const j = req.body;
  const now = new Date().toISOString();
  // Auto-generate ID if missing
  if (!j.id) {
    const cnt = db.prepare('SELECT COUNT(*) as n FROM jobs').get();
    j.id = 'JOB-' + String(cnt.n + 1).padStart(4,'0');
  }
  if (!j.date) j.date = new Date().toLocaleDateString();
  if (!j.auditLog) j.auditLog = [];
  if (!j.flags) j.flags = [];
  j.auditLog.push({ts:new Date().toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}),user:'Shop Admin',action:'Estimate created',detail:''});
  const flagged = runFlags(j);
  db.prepare(`INSERT INTO jobs (id,date,customer,insurance,vehicle,parts,labor,status,tech,target,estimate,notes,flags,audit_log,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(j.id,j.date,JSON.stringify(j.customer),JSON.stringify(j.insurance),JSON.stringify(j.vehicle),
      JSON.stringify(j.parts),JSON.stringify(j.labor),j.status||'Estimate',j.tech||'',j.target||'',
      j.estimate||0,j.notes||'',JSON.stringify(flagged.flags),JSON.stringify(flagged.auditLog),now,now);
  res.json(rowToJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id)));
});

// PUT update job
app.put('/api/jobs/:id', (req, res) => {
  const j = req.body;
  const existing = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({error:'Not found'});
  const now = new Date().toISOString();
  const ts = new Date().toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  if (!j.auditLog) j.auditLog = JSON.parse(existing.audit_log);
  j.auditLog.push({ts,user:'Shop Admin',action:'Job updated',detail:''});
  if (!j.flags) j.flags = JSON.parse(existing.flags);
  const flagged = runFlags(j);
  db.prepare(`UPDATE jobs SET customer=?,insurance=?,vehicle=?,parts=?,labor=?,status=?,tech=?,target=?,
    estimate=?,notes=?,flags=?,audit_log=?,updated_at=? WHERE id=?`)
    .run(JSON.stringify(j.customer),JSON.stringify(j.insurance),JSON.stringify(j.vehicle),
      JSON.stringify(j.parts),JSON.stringify(j.labor),j.status||'Estimate',j.tech||'',j.target||'',
      j.estimate||0,j.notes||'',JSON.stringify(flagged.flags),JSON.stringify(flagged.auditLog),now,req.params.id);
  res.json(rowToJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id)));
});

// PATCH resolve flags
app.patch('/api/jobs/:id/resolve', (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({error:'Not found'});
  const flags = JSON.parse(row.flags).map(f => f.status==='active' ? {...f,status:'resolved'} : f);
  const auditLog = JSON.parse(row.audit_log);
  const ts = new Date().toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  auditLog.push({ts,user:'Shop Admin',action:'All flags resolved',detail:''});
  db.prepare('UPDATE jobs SET flags=?,audit_log=?,updated_at=? WHERE id=?')
    .run(JSON.stringify(flags),JSON.stringify(auditLog),new Date().toISOString(),req.params.id);
  res.json(rowToJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id)));
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Collision IQ running on port ${PORT}`));
