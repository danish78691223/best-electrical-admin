import React, { useMemo, useState } from 'react';
import { Upload, Users, ShieldCheck, RefreshCw, Send, MessageSquare, MessageCircle, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

function csvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(v => v)) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(v => v)) rows.push(row);
  return rows;
}

function parseContacts(text, fileName) {
  if (fileName.toLowerCase().endsWith('.vcf') || fileName.toLowerCase().endsWith('.vcard')) {
    const unfolded = text.replace(/\r?\n[ \t]/g, '');
    const blocks = unfolded.split(/BEGIN:VCARD/i).slice(1).map(x => x.split(/END:VCARD/i)[0]);
    const contacts = [];
    for (const block of blocks) {
      const nameLine = block.split(/\r?\n/).find(line => /^FN(?:;[^:]*)?:/i.test(line));
      const nLine = block.split(/\r?\n/).find(line => /^N(?:;[^:]*)?:/i.test(line));
      const name = nameLine ? nameLine.slice(nameLine.indexOf(':') + 1).trim()
        : nLine ? nLine.slice(nLine.indexOf(':') + 1).replace(/;/g, ' ').trim() : '';
      const phones = block.split(/\r?\n/).filter(line => /^TEL(?:;[^:]*)?:/i.test(line));
      for (const line of phones) {
        const value = line.slice(line.indexOf(':') + 1).trim();
        if (value) contacts.push({ name, phone: value, source: 'android-address-book' });
      }
    }
    return contacts;
  }
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error('CSV must contain a header row and at least one contact row.');
  const normalizeHeader = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = rows[0].map(normalizeHeader);
  const phoneIndex = headers.findIndex(x => ['phone','mobile','mobilenumber','phonenumber','number','telephone','tel'].includes(x));
  const nameIndex = headers.findIndex(x => ['name','fullname','contactname','displayname'].includes(x));
  if (phoneIndex < 0) throw new Error('CSV needs a Phone, Mobile, Number, or Telephone column.');
  return rows.slice(1).map(row => ({
    name: nameIndex >= 0 ? (row[nameIndex] || '') : '',
    phone: row[phoneIndex] || '',
    source: 'csv-import'
  })).filter(row => row.phone);
}

async function apiRequest(path, key, options = {}) {
  const response = await fetch(API + '/admin/marketing' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': key,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed (HTTP ' + response.status + ')');
  return payload;
}

export default function CampaignsPanel() {
  const [adminKey, setAdminKey] = useState('');
  const [customers, setCustomers] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [channels, setChannels] = useState(['sms']);
  const [preview, setPreview] = useState(null);
  const [draftId, setDraftId] = useState('');

  async function load() {
    if (!adminKey.trim()) { setNotice('Enter the backend ADMIN_API_KEY to unlock this section.'); return; }
    setBusy(true);
    try {
      const [customerData, campaignData] = await Promise.all([
        apiRequest('/contacts', adminKey),
        apiRequest('/campaigns', adminKey)
      ]);
      setCustomers(customerData.customers || []);
      setTotal(customerData.total || 0);
      setCampaigns(campaignData || []);
      setNotice('Marketing API connected. Imported contacts remain opted out until consent is recorded.');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  const visibleCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => (c.name + ' ' + c.phone).toLowerCase().includes(q));
  }, [customers, search]);

  async function readFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseContacts(text, file.name);
      const seen = new Set();
      const unique = parsed.filter(c => {
        const key = String(c.phone || '').replace(/\D/g, '');
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      });
      setFileName(file.name);
      setImportRows(unique);
      setNotice('Read ' + unique.length + ' unique phone entries. These entries are not promotional consent.');
    } catch (error) { setImportRows([]); setFileName(''); setNotice(error.message); }
  }

  async function importContacts() {
    if (!importRows.length) { setNotice('Choose a valid VCF or CSV first.'); return; }
    if (!adminKey.trim()) { setNotice('Enter the backend admin key first.'); return; }
    setBusy(true);
    try {
      let totalCreated = 0, totalUpdated = 0, totalInvalid = 0;
      for (let i = 0; i < importRows.length; i += 1000) {
        const result = await apiRequest('/contacts/import', adminKey, {
          method: 'POST',
          body: JSON.stringify({ contacts: importRows.slice(i, i + 1000) })
        });
        totalCreated += result.created || 0;
        totalUpdated += result.updated || 0;
        totalInvalid += result.invalid || 0;
      }
      setNotice('Import complete: ' + totalCreated + ' new, ' + totalUpdated + ' updated, ' + totalInvalid + ' invalid. No consent was created by import.');
      setImportRows([]);
      setFileName('');
      await load();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  async function setConsent(customer, channel, enabled) {
    let consentSource = '';
    if (enabled) {
      consentSource = window.prompt('Record how and when this customer gave ' + channel.toUpperCase() + ' marketing consent (for example, "QR opt-in, 15 Oct 2026"). Do not enable without actual consent:');
      if (!consentSource || consentSource.trim().length < 8) {
        setNotice('Consent was not changed. Record the real consent source/date first.');
        return;
      }
    } else {
      if (!window.confirm('Withdraw ' + channel.toUpperCase() + ' marketing consent for ' + customer.phone + '?')) return;
      consentSource = 'Withdrawn by admin at ' + new Date().toISOString();
    }
    try {
      await apiRequest('/contacts/' + customer.id + '/consent', adminKey, {
        method: 'PATCH',
        body: JSON.stringify({ channel, enabled, consentSource })
      });
      setNotice(channel.toUpperCase() + ' consent ' + (enabled ? 'recorded' : 'withdrawn') + ' for ' + customer.phone + '.');
      await load();
      setPreview(null);
    } catch (error) { setNotice(error.message); }
  }

  function toggleChannel(channel) {
    setChannels(current => current.includes(channel) ? current.filter(x => x !== channel) : [...current, channel]);
    setPreview(null);
  }

  async function previewCampaign() {
    if (!channels.length) { setNotice('Select SMS and/or WhatsApp.'); return; }
    try {
      const result = await apiRequest('/campaigns/preview', adminKey, { method: 'POST', body: JSON.stringify({ channels }) });
      setPreview(result);
      setNotice('Audience preview ready. Only contacts with active channel consent are counted.');
    } catch (error) { setNotice(error.message); }
  }

  async function createDraft() {
    if (!title.trim() || !message.trim()) { setNotice('Enter a campaign title and message.'); return; }
    try {
      const result = await apiRequest('/campaigns', adminKey, {
        method: 'POST',
        body: JSON.stringify({ title, message, channels })
      });
      setDraftId(result.id);
      setNotice(result.message || 'Draft created. No messages have been sent.');
      await load();
    } catch (error) { setNotice(error.message); }
  }

  async function queueDraft() {
    if (!draftId) { setNotice('Create a draft first.'); return; }
    const ok = window.confirm('Queue this campaign for all eligible, consented recipients? Only do this after provider setup and a small test.');
    if (!ok) return;
    try {
      const result = await apiRequest('/campaigns/' + draftId + '/queue', adminKey, { method: 'POST', body: '{}' });
      setNotice(result.message || 'Campaign queued.');
      setDraftId('');
      await load();
    } catch (error) { setNotice(error.message); }
  }

  return <div className="marketing-panel">
    <div className="marketing-heading">
      <div><span className="marketing-kicker">CONTACTS WITHOUT CUSTOMER APP INSTALL</span><h2>Customers & Campaigns</h2><p>Sync/import phone contacts, capture channel consent, then create campaigns for SMS or WhatsApp.</p></div>
      <button className="secondary" onClick={load} disabled={busy}><RefreshCw size={15}/> Refresh</button>
    </div>

    <section className="marketing-key">
      <label htmlFor="marketing-admin-key">Backend admin key</label>
      <input id="marketing-admin-key" type="password" autoComplete="off" placeholder="Enter ADMIN_API_KEY (not a VITE_ variable)" value={adminKey} onChange={e=>setAdminKey(e.target.value)} />
      <button className="primary" onClick={load} disabled={busy || !adminKey.trim()}><ShieldCheck size={15}/> Unlock marketing tools</button>
      <small>The key is held only in this page's memory and is not saved in local storage. Configure the matching ADMIN_API_KEY on the backend host. Existing admin APIs still need separate production authentication review.</small>
    </section>
    {notice && <div className="marketing-notice"><AlertTriangle size={16}/><span>{notice}</span></div>}

    <div className="marketing-stats">
      <div><Users size={18}/><span><b>{total}</b><small>Contacts</small></span></div>
      <div><MessageSquare size={18}/><span><b>{customers.filter(c=>c.smsConsent&&!c.doNotContact).length}</b><small>SMS opted-in</small></span></div>
      <div><MessageCircle size={18}/><span><b>{customers.filter(c=>c.whatsappConsent&&!c.doNotContact).length}</b><small>WhatsApp opted-in</small></span></div>
    </div>

    <section>
      <h3>1. Import phone contacts</h3>
      <p className="muted">Export contacts from Android Contacts as a .vcf file, or use a CSV with Name and Phone/Mobile columns. A web page cannot silently read the whole phone address book. On-device auto-sync requires the owner-only Android companion app.</p>
      <div className="import-row">
        <label className="file-picker"><Upload size={16}/><span>{fileName || 'Choose .VCF or .CSV'}</span><input type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" onChange={e=>readFile(e.target.files?.[0])}/></label>
        <button className="primary" onClick={importContacts} disabled={busy || !importRows.length}><Users size={15}/> Import {importRows.length || ''} contacts</button>
      </div>
      {importRows.length>0 && <p className="import-summary">Preview: {importRows.length} unique phone entries. Import will never set SMS/WhatsApp consent to true.</p>}
    </section>

    <section>
      <div className="section-title-row"><h3>2. Customer consent registry</h3><input className="customer-search" placeholder="Search name or phone" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <p className="muted">Turn on a channel only after the customer has explicitly agreed; enter the source/date when prompted. Turning it off withdraws that channel's consent.</p>
      <div className="tablewrap">
        <table><thead><tr><th>Customer</th><th>Phone</th><th>SMS consent</th><th>WhatsApp consent</th><th>Source</th></tr></thead>
          <tbody>{visibleCustomers.slice(0,500).map(c=><tr key={c.id}>
            <td>{c.name || '—'}</td><td>{c.phone}</td>
            <td><button className={c.smsConsent?'pill-button active':'pill-button'} onClick={()=>setConsent(c,'sms',!c.smsConsent)}>{c.smsConsent?'Opted in':'Not opted in'}</button></td>
            <td><button className={c.whatsappConsent?'pill-button active':'pill-button'} onClick={()=>setConsent(c,'whatsapp',!c.whatsappConsent)}>{c.whatsappConsent?'Opted in':'Not opted in'}</button></td>
            <td>{c.source || '—'}{c.doNotContact?' · Suppressed':''}</td>
          </tr>)}</tbody>
        </table>
        {visibleCustomers.length===0 && <p className="muted">No contacts loaded. Enter the key and refresh, or import a VCF/CSV.</p>}
        {visibleCustomers.length>500 && <p className="muted">Showing first 500 matching contacts. Use search to narrow the list.</p>}
      </div>
    </section>

    <section>
      <h3>3. Create offer campaign</h3>
      <p className="muted">Customers do not need an app. SMS and WhatsApp campaigns only include people who have active consent for the selected channel.</p>
      <div className="channel-choices">
        <label><input type="checkbox" checked={channels.includes('sms')} onChange={()=>toggleChannel('sms')}/> SMS</label>
        <label><input type="checkbox" checked={channels.includes('whatsapp')} onChange={()=>toggleChannel('whatsapp')}/> WhatsApp Business</label>
      </div>
      {channels.length===2 && <p className="warning-inline">Selecting both channels may send two messages to a customer who opted into both. Use a single channel if you do not intend that.</p>}
      <div className="campaign-form">
        <input placeholder="Campaign title (e.g. Diwali savings)" maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/>
        <textarea rows={4} maxLength={1024} placeholder="Offer message (WhatsApp template must have approved {{1}} body variable)" value={message} onChange={e=>setMessage(e.target.value)}/>
        <small>{message.length}/1024 characters. SMS segments and template limits may vary by provider.</small>
        <div className="campaign-actions">
          <button className="secondary" onClick={previewCampaign} disabled={!channels.length}><Users size={15}/> Preview audience</button>
          <button className="primary" onClick={createDraft} disabled={!channels.length || !title.trim() || !message.trim()}><CheckCircle2 size={15}/> Save draft</button>
          <button className="primary queue-button" onClick={queueDraft} disabled={!draftId}><Send size={15}/> Queue saved draft</button>
        </div>
      </div>
      {preview && <div className="audience-preview">
        <h4>Audience preview</h4>
        <div className="preview-numbers"><span><b>{preview.uniqueCustomers}</b><small>Unique customers</small></span><span><b>{preview.eligibleDeliveries}</b><small>Channel deliveries</small></span><span><b>{preview.byChannel?.sms||0}</b><small>SMS recipients</small></span><span><b>{preview.byChannel?.whatsapp||0}</b><small>WhatsApp recipients</small></span></div>
        <p className="muted">SMS provider: {preview.configuredProviders?.sms?'configured':'not configured'} · WhatsApp provider: {preview.configuredProviders?.whatsapp?'configured':'not configured'}</p>
        <p className="muted">{preview.note}</p>
      </div>}
    </section>

    <section>
      <h3>4. Campaign history</h3>
      {campaigns.length===0 ? <p className="muted">No campaigns created yet.</p> : campaigns.map(c=><div className="campaign-history-row" key={c.id}>
        <div><b>{c.title}</b><p>{(c.channels||[]).join(' + ').toUpperCase()} · {c.recipientCount} channel deliveries</p><small>{new Date(c.createdAt).toLocaleString()}</small></div>
        <span className={'status-pill status-'+c.status}><Clock3 size={13}/>{c.status}</span>
      </div>)}
    </section>
    <p className="marketing-disclaimer">Before live sending: configure backend provider credentials, approved WhatsApp template, required Indian DLT sender/header/templates and consent. Provider “accepted” status is not the same as a confirmed phone delivery.</p>
  </div>;
}
