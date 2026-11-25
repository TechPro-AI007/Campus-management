// Switch this to http://127.0.0.1:5000 when running Flask locally.
const API_BASE_URL = 'https://campus-management124.onrender.com';
const $ = (selector) => document.querySelector(selector);
const state = { events: [], status: 'all', query: '', currentEvent: null, registrations: [] };
const closedStatuses = new Set(['closed', 'cancelled', 'canceled', 'completed']);
const isClosed = (event) => closedStatuses.has(String(event.status || '').toLowerCase());
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, options = {}) {
  let response;
  try { response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers } }); }
  catch { throw new Error('Could not reach the Campus.io API. Check the server or API_BASE_URL.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || `Request failed (${response.status}).`); error.status = response.status; throw error; }
  return body.data;
}
function userId() { return $('#user-id').value.trim(); }
function organizerId() { return $('#organizer-id').value.trim(); }
function eventStatus(event) { return isClosed(event) ? 'closed' : 'upcoming'; }
function filteredEvents() { return state.events.filter(event => (state.status === 'all' || eventStatus(event) === state.status) && String(event.title || '').toLowerCase().includes(state.query)); }
function renderEvents() {
  const grid = $('#events-grid'), events = filteredEvents();
  $('#event-count').textContent = state.events.length;
  $('#results-label').textContent = `Showing ${events.length} of ${state.events.length} events`;
  if (!events.length) { grid.innerHTML = `<div class="state-card">${state.events.length ? 'No events match your search and filters.' : 'No events are available right now.'}</div>`; return; }
  grid.innerHTML = events.map((event, index) => `<article class="event-card"><div class="card-art art-${index%4}"><span class="art-icon">${['✦','⌘','◈','◉'][index%4]}</span><span class="status ${isClosed(event)?'closed':''}">${isClosed(event)?'Registration closed':'Registration open'}</span></div><div class="card-body"><h3>${escapeHtml(event.title || 'Campus event')}</h3><div class="card-id">EVENT · ${escapeHtml(event.id)}</div><div class="card-meta"><span>Capacity</span><strong>${event.capacity == null ? 'Not specified' : `${escapeHtml(event.capacity)} seats`}</strong></div></div><div class="card-actions"><button class="outline-btn details-btn" data-id="${escapeHtml(event.id)}">View Details</button><button class="primary-btn register-btn" data-id="${escapeHtml(event.id)}" ${isClosed(event)?'disabled':''}>Register Now</button></div></article>`).join('');
  grid.querySelectorAll('.event-card').forEach(card => { const message=document.createElement('div'); message.className='card-message inline-message'; message.setAttribute('aria-live','polite'); card.appendChild(message); });
  grid.querySelectorAll('.details-btn').forEach(button => button.addEventListener('click', () => openDetails(button.dataset.id)));
  grid.querySelectorAll('.register-btn').forEach(button => button.addEventListener('click', () => register(button.dataset.id, button)));
}
async function loadEvents() {
  $('#events-grid').innerHTML = '<div class="state-card">Loading events from Campus.io…</div>';
  try { state.events = await api('/api/events'); renderEvents(); populateOrganizerEvents(); }
  catch (error) { $('#events-grid').innerHTML = `<div class="state-card">${escapeHtml(error.message)} <button class="outline-btn" id="retry-events">Retry</button></div>`; $('#retry-events').addEventListener('click', loadEvents); }
}
function populateOrganizerEvents() { const select=$('#organizer-event'), previous=select.value; select.innerHTML='<option value="">Choose an event</option>'+state.events.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.title||e.id)}</option>`).join(''); if(state.events.some(e=>e.id===previous))select.value=previous; }
function setInline(element, text, kind='') { element.textContent=text; element.className=`inline-message ${kind}`; }
async function openDetails(id) {
  $('#modal').classList.remove('hidden'); $('#modal-content').innerHTML='<h2 id="modal-title">Loading event…</h2>'; $('#modal-message').textContent=''; $('#modal-register').disabled=true;
  try {
    const event=await api(`/api/events/${encodeURIComponent(id)}`); state.currentEvent=event;
    $('#modal-content').innerHTML=`<h2 id="modal-title">${escapeHtml(event.title||'Campus event')}</h2><div class="modal-meta"><div class="detail-row"><small>Event ID</small><span>${escapeHtml(event.id)}</span></div><div class="detail-row"><small>Organizer ID</small><span>${escapeHtml(event.organizer_id||'Not provided')}</span></div><div class="detail-row"><small>Registration status</small><span>${isClosed(event)?'Closed':'Upcoming · Registration open'}</span></div><div class="detail-row"><small>Capacity</small><span>${event.capacity==null?'Not specified':`${escapeHtml(event.capacity)} seats`}</span></div></div>`;
    $('#modal-register').disabled=isClosed(event); $('#modal-register').textContent=isClosed(event)?'Registration Closed':'Register Now';
  } catch(error) { $('#modal-content').innerHTML=`<h2 id="modal-title">Event unavailable</h2><p>${escapeHtml(error.message)}</p>`; $('#modal-register').disabled=true; }
}
async function register(id, button) {
  const uid=userId(), cardMessage=button?.closest('.event-card')?.querySelector('.card-message'); if(!uid){const text='Enter an active User ID first.';showToast(text);if(cardMessage)setInline(cardMessage,text,'error');$('#user-id').focus();return;}
  const prior=button?.textContent; if(button){button.disabled=true;button.textContent='Registering…';}
  const msg=$('#modal-message'); if(state.currentEvent?.id===id)setInline(msg,'Registering…'); if(cardMessage)setInline(cardMessage,'Registering…');
  try { await api('/api/registrations',{method:'POST',body:JSON.stringify({user_id:uid,event_id:id})}); const text='Success! You are registered for this event.'; showToast('Registration confirmed.'); if(state.currentEvent?.id===id)setInline(msg,text,'success'); if(cardMessage)setInline(cardMessage,text,'success'); await loadRegistrations(false); }
  catch(error) { let text=error.message; if(error.status===409){if(/already registered/i.test(text))text='You are already registered for this event.';else if(/capacity|full/i.test(text))text='This event is full.';else if(/closed|not open/i.test(text))text='Registration is closed for this event.';} if(state.currentEvent?.id===id)setInline(msg,text,'error');if(cardMessage)setInline(cardMessage,text,'error');showToast(text); }
  finally { if(button){button.disabled=isClosed(state.events.find(e=>e.id===id)||{});button.textContent=prior;} }
}
async function loadRegistrations(showState=true) {
  const list=$('#registrations-list'), uid=userId();
  if(!uid){if(showState)list.innerHTML='<div class="state-card">Enter an active User ID to load registrations.</div>';$('#reg-count').textContent='0';return;}
  if(showState)list.innerHTML='<div class="state-card">Loading your registrations…</div>';
  try {
    const rows=await api(`/api/me/registrations?user_id=${encodeURIComponent(uid)}`); state.registrations=rows; $('#reg-count').textContent=rows.length;
    if(!rows.length){list.innerHTML='<div class="state-card">No registrations found for this User ID.</div>';return;}
    const events=await Promise.all(rows.map(async row=>{try{return await api(`/api/events/${encodeURIComponent(row.event_id)}`);}catch{return {id:row.event_id,title:'Event details unavailable'};}}));
    list.innerHTML=rows.map((row,i)=>{const e=events[i];return `<article class="ticket"><div class="ticket-top"><span>● &nbsp;CONFIRMED REGISTRATION</span><code>${escapeHtml(row.id)}</code></div><div class="ticket-content"><h3>${escapeHtml(e.title||'Campus event')}</h3><dl><div><dt>Event ID</dt><dd>${escapeHtml(e.id)}</dd></div><div><dt>Status</dt><dd>${isClosed(e)?'Closed':'Upcoming'}</dd></div><div><dt>Registered</dt><dd>${escapeHtml(row.created_at||'')}</dd></div><div><dt>Capacity</dt><dd>${e.capacity==null?'Not specified':`${escapeHtml(e.capacity)} seats`}</dd></div></dl></div></article>`;}).join('');
  } catch(error){list.innerHTML=`<div class="state-card">${escapeHtml(error.message)}</div>`;}
}
async function loadAttendees() {
  const id=$('#organizer-event').value, oid=organizerId(), target=$('#attendee-content');
  if(!id){setInline($('#organizer-message'),'Choose an event first.','error');return;} if(!oid){setInline($('#organizer-message'),'Enter an Organizer ID first.','error');$('#organizer-id').focus();return;}
  target.innerHTML='';setInline($('#organizer-message'),'Loading attendee list…');
  try {const rows=await api(`/api/events/${encodeURIComponent(id)}/registrations?organizer_id=${encodeURIComponent(oid)}`);setInline($('#organizer-message'),`${rows.length} attendee${rows.length===1?'':'s'} registered.`,'success');if(!rows.length){target.innerHTML='<div class="state-card">No attendees registered for this event.</div>';return;}target.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Registration</th><th>User ID</th><th>Email</th><th>Registered at</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.user_id)}</td><td>${escapeHtml(r.email||'—')}</td><td>${escapeHtml(r.created_at||'—')}</td></tr>`).join('')}</tbody></table></div>`;}
  catch(error){setInline($('#organizer-message'),error.message,'error');}
}
function showToast(text){const toast=$('#toast');toast.textContent=text;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),3200);}
function switchView(view){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active-view',v.id===`view-${view}`));document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='registrations')loadRegistrations();}
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{state.status=b.dataset.status;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderEvents();}));
$('#search').addEventListener('input',e=>{state.query=e.target.value.toLowerCase().trim();renderEvents();});
$('#user-id').addEventListener('change',()=>{if($('#view-registrations').classList.contains('active-view'))loadRegistrations();});
$('#load-attendees').addEventListener('click',loadAttendees);$('#organizer-event').addEventListener('change',()=>{ $('#attendee-content').innerHTML=''; $('#organizer-message').textContent=''; });
$('#modal-register').addEventListener('click',()=>state.currentEvent&&register(state.currentEvent.id));
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>$('#modal').classList.add('hidden')));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();}if(e.key==='Escape')$('#modal').classList.add('hidden');});
loadEvents();
