'use strict';

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'shopEstimatorJobs';

function loadJobs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch (e) { return []; }
}

function saveJobs(jobs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

// ── Seeded Demo Data ──────────────────────────────────────────────────────────

function seedDemoData() {
  if (loadJobs().length > 0) return;

  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const pastDate  = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

  const jobs = [
    {
      id: 'JOB-0001', status: 'In Progress',
      customerName: 'Maria Garcia', customerEmail: 'maria@example.com', customerPhone: '555-201-0001',
      vehicleYear: '2021', vehicleMake: 'Honda', vehicleModel: 'Accord', vehicleVin: '1HGCV1F3XLA025410',
      vehicleColor: 'Pearl White', insurance: 'State Farm', adjuster: 'Tom Willis', claimNumber: 'SF-2026-0441',
      technician: 'Ray Chen',
      damageScope: 'Moderate', targetDate: today, damageDescription: 'Front bumper, hood, and grille damage from front-end collision.',
      parts: [
        { description: 'Front Bumper Assembly', partNumber: 'HND-FB-21', qty: 1, unitCost: 380, unitPrice: 520 },
        { description: 'Hood Panel', partNumber: 'HND-HP-21', qty: 1, unitCost: 640, unitPrice: 890 },
      ],
      labor: [
        { description: 'Bumper R&R', hours: 2.5, rate: 95 },
        { description: 'Hood Replacement & Align', hours: 4, rate: 95 },
      ],
      estimatedTotal: 1700, notes: 'Insurance pre-approved up to $2,000.',
      auditTrail: [], createdAt: yesterday, updatedAt: today,
    },
    {
      id: 'JOB-0002', status: 'Created',
      customerName: 'Derek Patel', customerEmail: 'derek@example.com', customerPhone: '555-202-0002',
      vehicleYear: '2019', vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleVin: '1FTFW1ET5DFC10312',
      vehicleColor: 'Oxford White', insurance: 'Allstate', adjuster: '', claimNumber: 'AL-2026-0887',
      technician: '',   // intentionally missing → triggers critical flag
      damageScope: 'Major', targetDate: pastDate, damageDescription: 'Passenger-side door, quarter panel, and rear bumper.',
      parts: [
        { description: 'Door Panel Assembly – Pass.', partNumber: 'FRD-DP-P19', qty: 1, unitCost: 740, unitPrice: 1050 },
        { description: 'Quarter Panel', partNumber: 'FRD-QP-19', qty: 1, unitCost: 520, unitPrice: 760 },
        { description: 'Rear Bumper Cover', partNumber: 'FRD-RB-19', qty: 1, unitCost: 310, unitPrice: 440 },
      ],
      labor: [
        { description: 'Door & Quarter Repair', hours: 8, rate: 95 },
        { description: 'Bumper R&R', hours: 2, rate: 95 },
      ],
      estimatedTotal: 1800,  // actual will be ~2820 → >20% variance
      notes: 'Adjuster not yet assigned. Hold until claim confirmed.',
      auditTrail: [], createdAt: pastDate, updatedAt: pastDate,
    },
    {
      id: 'JOB-0003', status: 'In Progress',
      customerName: 'Lisa Monroe', customerEmail: 'lisa@example.com', customerPhone: '555-203-0003',
      vehicleYear: '2020', vehicleMake: 'Toyota', vehicleModel: 'RAV4', vehicleVin: '2T3BWRFV4LW025983',
      vehicleColor: 'Magnetic Gray', insurance: 'GEICO', adjuster: 'Susan Park', claimNumber: 'GC-2026-1134',
      technician: 'Alex Tran',
      damageScope: 'Minor', targetDate: pastDate, damageDescription: 'Rear bumper scuff and minor trunk lid dent.',
      parts: [
        { description: 'Rear Bumper Cover', partNumber: 'TOY-RB-20', qty: 1, unitCost: 260, unitPrice: 380 },
      ],
      labor: [
        { description: 'Bumper R&R + Paint', hours: 3, rate: 95 },
        { description: 'Trunk Lid Dent Repair', hours: 1.5, rate: 95 },
      ],
      estimatedTotal: 800, notes: 'Customer requested completion by end of week. Running 3 days late.',
      auditTrail: [], createdAt: pastDate, updatedAt: pastDate,
    },
  ];

  saveJobs(jobs);
}

// ── Flag Engine ───────────────────────────────────────────────────────────────

function calcActualTotal(job) {
  const partsTotal = (job.parts || []).reduce((s, p) => s + p.qty * p.unitPrice, 0);
  const laborTotal = (job.labor || []).reduce((s, l) => s + l.hours * l.rate, 0);
  return partsTotal + laborTotal;
}

function runFlagEngine(job) {
  const flags = [];

  if (!job.technician || !job.technician.trim()) {
    flags.push({ code: 'MISSING_TECH', type: 'critical', message: 'No technician assigned' });
  }
  if (!job.customerName || !job.customerName.trim()) {
    flags.push({ code: 'MISSING_CUSTOMER', type: 'critical', message: 'Customer name required' });
  }

  const actual    = calcActualTotal(job);
  const estimated = parseFloat(job.estimatedTotal) || 0;
  if (estimated > 0 && actual > 0) {
    const pct = (actual - estimated) / estimated;
    if (Math.abs(pct) > 0.20) {
      flags.push({ code: 'VARIANCE_CRITICAL', type: 'critical', message: `${(pct * 100).toFixed(1)}% price variance vs estimate (critical >20%)` });
    } else if (Math.abs(pct) > 0.10) {
      flags.push({ code: 'VARIANCE_WARNING', type: 'warning', message: `${(pct * 100).toFixed(1)}% price variance vs estimate` });
    }
  }

  if (job.targetDate && job.status !== 'Complete' && job.status !== 'Closed') {
    const target = new Date(job.targetDate + 'T23:59:59');
    if (new Date() > target) {
      flags.push({ code: 'PAST_TARGET', type: 'warning', message: `Job past target completion date (${job.targetDate})` });
    }
  }

  return flags;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function statusBadge(s) {
  const cls = { 'Created': 'badge-created', 'In Progress': 'badge-progress', 'Complete': 'badge-complete', 'Closed': 'badge-closed', 'Total Loss': 'badge-total' };
  return `<span class="badge ${cls[s] || 'badge-created'}">${s}</span>`;
}

function nextJobId(jobs) {
  const nums = jobs.map(j => parseInt((j.id || '').replace('JOB-', ''), 10)).filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'JOB-' + String(next).padStart(4, '0');
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── View Router ───────────────────────────────────────────────────────────────

const views = ['list', 'form', 'pdf', 'audit'];
let currentEditId = null;

function showView(name) {
  views.forEach(v => {
    document.getElementById('view-' + v).classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name);
  });
}

// ── Job List ─────────────────────────────────────────────────────────────────

function renderList(filter) {
  const jobs  = loadJobs();
  const query = (filter || '').toLowerCase().trim();
  const filtered = query
    ? jobs.filter(j =>
        (j.id||'').toLowerCase().includes(query) ||
        (j.customerName||'').toLowerCase().includes(query) ||
        `${j.vehicleYear} ${j.vehicleMake} ${j.vehicleModel}`.toLowerCase().includes(query)
      )
    : jobs;

  document.getElementById('jobCount').textContent = filtered.length;

  // Flag summary
  const flaggedCount = filtered.filter(j => runFlagEngine(j).length > 0).length;
  document.getElementById('flagCount').textContent =
    flaggedCount > 0 ? `⚑ ${flaggedCount} job${flaggedCount > 1 ? 's' : ''} with flags` : '';

  const tbody = document.getElementById('jobTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No jobs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(j => {
    const flags  = runFlagEngine(j);
    const actual = calcActualTotal(j);
    const flagBadges = flags.map(f =>
      `<span class="flag-badge flag-${f.type}" title="${esc(f.message)}">${f.type === 'critical' ? '⚑ C' : '⚑ W'}</span>`
    ).join(' ');
    return `<tr>
      <td style="font-family:monospace;font-weight:600">${esc(j.id)}</td>
      <td>${esc(j.customerName)}</td>
      <td>${esc([j.vehicleYear, j.vehicleMake, j.vehicleModel].filter(Boolean).join(' '))}</td>
      <td>${j.technician ? esc(j.technician) : '<span style="color:#c0392b;font-size:.8rem">⚑ Unassigned</span>'}</td>
      <td>${statusBadge(j.status)}</td>
      <td>${fmt(actual)}</td>
      <td>${flagBadges || '<span style="color:#aaa;font-size:.8rem">None</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="editJob('${esc(j.id)}')">Edit</button>
        <button class="btn btn-sm" onclick="previewPdf('${esc(j.id)}')" style="margin-left:.3rem">PDF</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Job Form ──────────────────────────────────────────────────────────────────

let partRows  = [];
let laborRows = [];

function addPartRow(data) {
  partRows.push(data || { description: '', partNumber: '', qty: 1, unitCost: 0, unitPrice: 0 });
  renderPartRows();
}

function addLaborRow(data) {
  laborRows.push(data || { description: '', hours: 0, rate: 95 });
  renderLaborRows();
}

function renderPartRows() {
  const tbody = document.getElementById('partsBody');
  tbody.innerHTML = partRows.map((p, i) => `
    <tr>
      <td><input type="text" value="${esc(p.description)}" onchange="partRows[${i}].description=this.value" placeholder="Part description"></td>
      <td><input type="text" value="${esc(p.partNumber)}" onchange="partRows[${i}].partNumber=this.value" placeholder="Part #" style="width:90px"></td>
      <td><input type="number" value="${p.qty}" min="1" step="1" onchange="partRows[${i}].qty=+this.value;updateTotals()" style="width:55px"></td>
      <td><input type="number" value="${p.unitCost}" min="0" step="0.01" onchange="partRows[${i}].unitCost=+this.value;updateTotals()" style="width:90px"></td>
      <td><input type="number" value="${p.unitPrice}" min="0" step="0.01" onchange="partRows[${i}].unitPrice=+this.value;updateTotals()" style="width:90px"></td>
      <td id="partLine${i}" style="white-space:nowrap">${fmt(p.qty * p.unitPrice)}</td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="removePart(${i})">✕</button></td>
    </tr>`).join('');
  updateTotals();
}

function renderLaborRows() {
  const tbody = document.getElementById('laborBody');
  tbody.innerHTML = laborRows.map((l, i) => `
    <tr>
      <td><input type="text" value="${esc(l.description)}" onchange="laborRows[${i}].description=this.value" placeholder="Labor description"></td>
      <td><input type="number" value="${l.hours}" min="0" step="0.5" onchange="laborRows[${i}].hours=+this.value;updateTotals()" style="width:70px"></td>
      <td><input type="number" value="${l.rate}" min="0" step="1" onchange="laborRows[${i}].rate=+this.value;updateTotals()" style="width:80px"></td>
      <td id="laborLine${i}" style="white-space:nowrap">${fmt(l.hours * l.rate)}</td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="removeLabor(${i})">✕</button></td>
    </tr>`).join('');
  updateTotals();
}

function removePart(i)  { partRows.splice(i, 1); renderPartRows(); }
function removeLabor(i) { laborRows.splice(i, 1); renderLaborRows(); }

function updateTotals() {
  const partsTotal = partRows.reduce((s, p) => s + p.qty * p.unitPrice, 0);
  const laborTotal = laborRows.reduce((s, l) => s + l.hours * l.rate, 0);
  const actual     = partsTotal + laborTotal;
  const estimated  = parseFloat(document.querySelector('[name=estimatedTotal]')?.value) || 0;

  document.getElementById('partsSubtotal').textContent = fmt(partsTotal);
  document.getElementById('laborSubtotal').textContent = fmt(laborTotal);
  document.getElementById('actualTotalDisplay').textContent = fmt(actual);

  // Update per-line totals
  partRows.forEach((p, i) => {
    const el = document.getElementById('partLine' + i);
    if (el) el.textContent = fmt(p.qty * p.unitPrice);
  });
  laborRows.forEach((l, i) => {
    const el = document.getElementById('laborLine' + i);
    if (el) el.textContent = fmt(l.hours * l.rate);
  });

  // Variance
  const varianceRow = document.getElementById('varianceRow');
  if (estimated > 0 && actual > 0) {
    const pct = (actual - estimated) / estimated;
    const disp = document.getElementById('varianceDisplay');
    disp.textContent = `${fmt(actual - estimated)} (${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%)`;
    disp.style.color = Math.abs(pct) > 0.20 ? '#8B0000' : Math.abs(pct) > 0.10 ? '#7A6000' : '#1A6B1A';
    varianceRow.style.display = '';
  } else {
    varianceRow.style.display = 'none';
  }
}

function loadForm(jobId) {
  const jobs = loadJobs();
  const job  = jobId ? jobs.find(j => j.id === jobId) : null;
  currentEditId = jobId || null;

  document.getElementById('formTitle').textContent = job ? `Edit Job — ${job.id}` : 'New Job';
  document.getElementById('navNewJob').textContent = '+ New Job';

  const form = document.getElementById('jobForm');

  // Reset fields
  const fields = ['customerName','customerEmail','customerPhone',
    'vehicleYear','vehicleMake','vehicleModel','vehicleVin','vehicleColor',
    'insurance','adjuster','claimNumber','technician',
    'damageScope','targetDate','damageDescription','status','estimatedTotal','notes'];
  fields.forEach(f => { const el = form.querySelector(`[name=${f}]`); if (el) el.value = job ? (job[f] || '') : (f === 'status' ? 'Created' : ''); });

  partRows  = job ? JSON.parse(JSON.stringify(job.parts  || [])) : [];
  laborRows = job ? JSON.parse(JSON.stringify(job.labor  || [])) : [];
  renderPartRows();
  renderLaborRows();
  updateTotals();
}

function saveJobFromForm() {
  const form = document.getElementById('jobForm');
  if (!form.checkValidity()) { form.reportValidity(); return null; }

  const get = name => {
    const el = form.querySelector(`[name=${name}]`);
    return el ? el.value.trim() : '';
  };

  const jobs  = loadJobs();
  const isNew = !currentEditId;
  const existing = isNew ? null : jobs.find(j => j.id === currentEditId);
  const now   = new Date().toISOString();

  const job = {
    id:              isNew ? nextJobId(jobs) : currentEditId,
    status:          get('status'),
    customerName:    get('customerName'),
    customerEmail:   get('customerEmail'),
    customerPhone:   get('customerPhone'),
    vehicleYear:     get('vehicleYear'),
    vehicleMake:     get('vehicleMake'),
    vehicleModel:    get('vehicleModel'),
    vehicleVin:      get('vehicleVin'),
    vehicleColor:    get('vehicleColor'),
    insurance:       get('insurance'),
    adjuster:        get('adjuster'),
    claimNumber:     get('claimNumber'),
    technician:      get('technician'),
    damageScope:     get('damageScope'),
    targetDate:      get('targetDate'),
    damageDescription: get('damageDescription'),
    parts:           JSON.parse(JSON.stringify(partRows)),
    labor:           JSON.parse(JSON.stringify(laborRows)),
    estimatedTotal:  parseFloat(get('estimatedTotal')) || 0,
    notes:           get('notes'),
    auditTrail:      existing ? existing.auditTrail : [],
    createdAt:       existing ? existing.createdAt : now,
    updatedAt:       now,
  };

  if (isNew) {
    jobs.push(job);
  } else {
    const idx = jobs.findIndex(j => j.id === currentEditId);
    if (idx >= 0) jobs[idx] = job;
  }

  saveJobs(jobs);
  return job;
}

function editJob(id) {
  loadForm(id);
  showView('form');
}

// ── PDF Preview ───────────────────────────────────────────────────────────────

function previewPdf(jobId) {
  const jobs = loadJobs();
  const job  = jobs.find(j => j.id === jobId);
  if (!job) return;

  const partsTotal  = (job.parts  || []).reduce((s, p) => s + p.qty * p.unitPrice, 0);
  const laborTotal  = (job.labor  || []).reduce((s, l) => s + l.hours * l.rate, 0);
  const grandTotal  = partsTotal + laborTotal;

  const partsRows = (job.parts || []).length
    ? (job.parts || []).map(p => `
        <tr>
          <td>${esc(p.description)}</td>
          <td>${esc(p.partNumber || '—')}</td>
          <td style="text-align:center">${p.qty}</td>
          <td style="text-align:right">${fmt(p.unitPrice)}</td>
          <td style="text-align:right">${fmt(p.qty * p.unitPrice)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" style="color:#aaa;text-align:center;padding:.5rem">No parts listed.</td></tr>';

  const laborRows2 = (job.labor || []).length
    ? (job.labor || []).map(l => `
        <tr>
          <td>${esc(l.description)}</td>
          <td style="text-align:center">${l.hours}</td>
          <td style="text-align:right">${fmt(l.rate)}</td>
          <td style="text-align:right">${fmt(l.hours * l.rate)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="color:#aaa;text-align:center;padding:.5rem">No labor listed.</td></tr>';

  document.getElementById('pdfContent').innerHTML = `
    <div class="pdf-header">
      <div>
        <div class="pdf-shop-name">Auto Body Shop</div>
        <div style="font-size:.8rem;color:#888;margin-top:.2rem">123 Main St &bull; City, ST 00000 &bull; (555) 000-0000</div>
      </div>
      <div>
        <div class="pdf-doc-title">Repair Estimate</div>
        <div class="pdf-doc-id">${esc(job.id)} &bull; ${new Date(job.createdAt).toLocaleDateString()}</div>
      </div>
    </div>

    <div class="pdf-section">
      <div class="pdf-section-title">Customer &amp; Vehicle</div>
      <div class="pdf-grid-2">
        <div>
          <div class="pdf-field"><span class="pdf-label">Customer</span><span class="pdf-val">${esc(job.customerName)}</span></div>
          <div class="pdf-field"><span class="pdf-label">Phone</span><span class="pdf-val">${esc(job.customerPhone||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">Email</span><span class="pdf-val">${esc(job.customerEmail||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">Insurance</span><span class="pdf-val">${esc(job.insurance||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">Claim #</span><span class="pdf-val">${esc(job.claimNumber||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">Adjuster</span><span class="pdf-val">${esc(job.adjuster||'—')}</span></div>
        </div>
        <div>
          <div class="pdf-field"><span class="pdf-label">Vehicle</span><span class="pdf-val">${esc([job.vehicleYear,job.vehicleMake,job.vehicleModel].filter(Boolean).join(' '))}</span></div>
          <div class="pdf-field"><span class="pdf-label">Color</span><span class="pdf-val">${esc(job.vehicleColor||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">VIN</span><span class="pdf-val" style="font-family:monospace">${esc(job.vehicleVin||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">Damage Level</span><span class="pdf-val">${esc(job.damageScope||'—')}</span></div>
          <div class="pdf-field"><span class="pdf-label">Description</span><span class="pdf-val">${esc(job.damageDescription||'—')}</span></div>
        </div>
      </div>
    </div>

    <div class="pdf-section">
      <div class="pdf-section-title">Parts</div>
      <table class="pdf-table">
        <thead><tr><th>Description</th><th>Part #</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${partsRows}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right">Parts Subtotal</td><td style="text-align:right">${fmt(partsTotal)}</td></tr></tfoot>
      </table>
    </div>

    <div class="pdf-section">
      <div class="pdf-section-title">Labor</div>
      <table class="pdf-table">
        <thead><tr><th>Description</th><th style="text-align:center">Hours</th><th style="text-align:right">Rate/hr</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${laborRows2}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right">Labor Subtotal</td><td style="text-align:right">${fmt(laborTotal)}</td></tr></tfoot>
      </table>
    </div>

    <div class="pdf-totals">
      <div class="pdf-total-row"><span>Parts</span><span>${fmt(partsTotal)}</span></div>
      <div class="pdf-total-row"><span>Labor</span><span>${fmt(laborTotal)}</span></div>
      <div class="pdf-total-row grand"><span>Grand Total</span><span>${fmt(grandTotal)}</span></div>
    </div>

    <div class="pdf-signatures">
      <div>
        <div class="pdf-sig-line"></div>
        <div class="pdf-sig-label">Customer Authorization &amp; Date</div>
      </div>
      <div>
        <div class="pdf-sig-line"></div>
        <div class="pdf-sig-label">Shop Representative &amp; Date</div>
      </div>
    </div>
    <div class="pdf-footer">This estimate is valid for 30 days. All prices are subject to change based on final inspection. Tax not included.</div>`;

  document.getElementById('backFromPdfBtn').onclick = () => {
    if (currentEditId) {
      loadForm(currentEditId);
      showView('form');
    } else {
      showView('list');
    }
  };

  showView('pdf');
}

// ── Audit Dashboard ───────────────────────────────────────────────────────────

function renderAudit() {
  const jobs    = loadJobs();
  const flagged = jobs.map(j => ({ job: j, flags: runFlagEngine(j) })).filter(x => x.flags.length > 0);

  document.getElementById('auditCount').textContent = flagged.length;

  const container = document.getElementById('auditList');
  if (flagged.length === 0) {
    container.innerHTML = '<p style="color:#aaa;text-align:center;padding:2rem">No flagged jobs. All clear.</p>';
    return;
  }

  container.innerHTML = flagged.map(({ job, flags }) => {
    const trail = (job.auditTrail || []).slice().reverse().slice(0, 5)
      .map(e => `<div class="audit-trail-entry">${esc(e.timestamp)} — ${esc(e.action)}</div>`).join('');

    const flagRows = flags.map(f => `
      <div class="audit-flag-row">
        <div>
          <span class="flag-badge flag-${f.type}">${f.type.toUpperCase()}</span>
          <span style="margin-left:.5rem">${esc(f.message)}</span>
        </div>
        <button class="btn btn-sm" onclick="resolveFlag('${esc(job.id)}','${esc(f.code)}')">Resolve</button>
      </div>`).join('');

    return `<div class="audit-card">
      <div class="audit-card-header">
        <div>
          <div class="audit-job-title">${esc(job.id)} — ${esc(job.customerName)}</div>
          <div class="audit-job-sub">${esc([job.vehicleYear,job.vehicleMake,job.vehicleModel].filter(Boolean).join(' '))} &bull; ${esc(job.technician||'Unassigned')} &bull; ${statusBadge(job.status)}</div>
        </div>
        <button class="btn btn-sm" onclick="editJob('${esc(job.id)}')">Edit Job</button>
      </div>
      <div class="audit-flags">${flagRows}</div>
      ${trail ? `<div class="audit-trail"><strong>Recent Activity:</strong>${trail}</div>` : ''}
    </div>`;
  }).join('');
}

function resolveFlag(jobId, code) {
  const jobs = loadJobs();
  const job  = jobs.find(j => j.id === jobId);
  if (!job) return;

  const now   = new Date().toLocaleString();
  const msg   = `Flag resolved: ${code}`;
  job.auditTrail = job.auditTrail || [];
  job.auditTrail.push({ timestamp: now, action: msg, code });
  job.updatedAt = new Date().toISOString();

  saveJobs(jobs);
  renderAudit();
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  seedDemoData();

  // Nav links
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const v = el.dataset.view;
      if (v === 'form') {
        loadForm(null);
      } else if (v === 'list') {
        renderList(document.getElementById('searchInput')?.value || '');
      } else if (v === 'audit') {
        renderAudit();
      }
      showView(v);
    });
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', e => {
    renderList(e.target.value);
  });

  // Add part / labor rows
  document.getElementById('addPartBtn').addEventListener('click',  () => addPartRow());
  document.getElementById('addLaborBtn').addEventListener('click', () => addLaborRow());

  // Estimate total change → recalc variance
  document.querySelector('[name=estimatedTotal]').addEventListener('input', updateTotals);

  // PDF from form
  document.getElementById('previewPdfBtn').addEventListener('click', () => {
    const saved = saveJobFromForm();
    if (saved) {
      currentEditId = saved.id;
      renderList();
      previewPdf(saved.id);
    }
  });

  // Save form
  document.getElementById('jobForm').addEventListener('submit', e => {
    e.preventDefault();
    const saved = saveJobFromForm();
    if (saved) {
      renderList();
      showView('list');
    }
  });

  // Initial render
  renderList();
  showView('list');
});
