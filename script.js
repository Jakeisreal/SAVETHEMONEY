// Step 1: 안정 코어 + 기본 유틸/상태/부팅
const STORAGE_KEY = 'educationBudgetPlannerState.v7';

// 전역 상태
const state = { settings:{}, plans:{}, nextPlanId:1, simulation:{}, onboardingShown:false };

// 유틸
const gen = p => `${p}_${Math.random().toString(36).slice(2,9)}`;
const coalesce = (v,f)=> (v===undefined||v===null)?f:v;
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }
function parseNumberInput(v){ if(v===null||v===undefined) return null; if(typeof v==='number') return Number.isFinite(v)?v:null; const cleaned=String(v).replace(/,/g,'').trim(); if(!cleaned) return null; const n=Number(cleaned); return Number.isFinite(n)?n:null; }
function formatNumberInput(v){ if(v===null||v===undefined||v==='') return ''; const n=(typeof v==='number')?v:parseNumberInput(v); if(n===null||!Number.isFinite(n)) return ''; return n.toLocaleString('ko-KR'); }
function sum(a){ return a.reduce((x,y)=>x+(Number(y)||0),0); }
function toKoreanCurrencyShort(n){ n=Math.floor(Number(n)||0); if(n<=0) return '0원'; const eok=Math.floor(n/1e8); const rem=n%1e8; const man=Math.floor(rem/1e4); const won=rem%1e4; const parts=[]; if(eok>0) parts.push(`${eok}억`); if(man>0) parts.push(`${man}만`); if(won>0) parts.push(`${won}`); return parts.join(' ')+'원'; }
function hangulHintHtml(val){ const n=parseNumberInput(val)||0; return `<div class="hint" style="font-size:.8em;color:#9cb5e9;margin-top:4px;">${toKoreanCurrencyShort(n)}</div>`; }

// 기본값 팩토리
function getDefaultSettings(){
  return {
    year: new Date().getFullYear()+1,
    currency:'KRW',
    legalBaseBudget: 180000000,
    legalMandatoryShare: null,
    jobDefaultOtherCost: 5000000,
    jobSessionsPerHead: { customer:1, nonCustomer:1 },
    avgJobSessionsPerPerson: 1,

    leadershipLevels: [ {id:gen('lead'),level:'임원',unitCost:680000}, {id:gen('lead'),level:'팀장',unitCost:540000} ],
    jobSegments: [
      { id:gen('jobseg'), name:'사내강사양성교육', ratio:30, unitCost:400000, category:'고객사 외' },
      { id:gen('jobseg'), name:'품질부문 교육',   ratio:30, unitCost:380000, category:'고객사 외' },
      { id:gen('jobseg'), name:'AI 역량 강화 교육', ratio:40, unitCost:500000, category:'고객사 외' }
    ],

    travelPolicy: {
      origins: [ {id:gen('org'),name:'본사(영천)'} ],
      destinations: [ {id:gen('dst'),name:'서울',band:'원거리'} ],
      matrix: {}, bandMatrix: {},
      perDiemRules: {
        applyPerDiemByBand:{'근거리':true,'원거리':true},
        applyLodgingByBand:{'근거리':true,'원거리':true},
        perDiemByBand:{'근거리':30000,'원거리':0},
        perRankByBand:{'원거리':{'사원':20000,'대리':25000,'과·차 이상':30000}},
        lodgingPerNight:60000, defaultNights:1
      }
    },

    hierarchyLevels: [ {id:gen('hier'),level:'주임',participation:90,unitCost:210000} ],
    legalTypes: [ {id:gen('legal'),type:'산업안전',ratio:40,unitCost:85000} ],
    miscCategories: [ {id:gen('misc'),name:'자격증 취득'} ],
    teams: [ {id:gen('team'),name:'HR팀',headcount:10,origin:'본사(영천)',rankLevel:'사원',customerSharePct:20,customerDestination:'서울',nonCustomerDestination:'서울',jobBudgetManual:0} ]
  };
}
function getEmptyPlans(){ return { leadership:[], job:[], hierarchy:[], legal:[], misc:[] }; }
function getDefaultSimulation(){ return { overallHeadcountDelta:0, overallUnitCostDelta:0, byTrack:{ leadership:{headcountDelta:0,unitCostDelta:0}, job:{headcountDelta:0,unitCostDelta:0}, hierarchy:{headcountDelta:0,unitCostDelta:0}, legal:{headcountDelta:0,unitCostDelta:0}, misc:{headcountDelta:0,unitCostDelta:0} } }; }

function initTravelMatrixIfNeeded(tp){ if(!tp.matrix) tp.matrix={}; if(!tp.bandMatrix) tp.bandMatrix={}; tp.origins.forEach(o=>{ if(!tp.matrix[o.name]) tp.matrix[o.name]={}; if(!tp.bandMatrix[o.name]) tp.bandMatrix[o.name]={}; }); }

// 병합 로직
function mergeSettings(defs, ovr){
  const base = JSON.parse(JSON.stringify(defs));
  const out = { ...base, ...ovr };
  ['leadershipLevels','jobSegments','hierarchyLevels','legalTypes','miscCategories','teams'].forEach(k=>{ out[k]=(ovr[k]||base[k]).map(x=>({ id:x.id||gen(k.slice(0,4)), ...x })); });
  out.jobSegments = out.jobSegments.map(s=>({ ...s, category: s.category||'고객사 외' }));
  out.travelPolicy = { ...(base.travelPolicy), ...(ovr.travelPolicy||{}) };
  out.travelPolicy.origins = (ovr.travelPolicy?.origins||base.travelPolicy.origins).map(x=>({ id:x.id||gen('org'), ...x }));
  out.travelPolicy.destinations = (ovr.travelPolicy?.destinations||base.travelPolicy.destinations).map(x=>({ id:x.id||gen('dst'), ...x }));
  out.travelPolicy.perDiemRules = {
    ...(base.travelPolicy.perDiemRules),
    ...(ovr.travelPolicy?.perDiemRules||{}),
    applyPerDiemByBand: { ...(base.travelPolicy.perDiemRules.applyPerDiemByBand), ...(ovr.travelPolicy?.perDiemRules?.applyPerDiemByBand||{}) },
    applyLodgingByBand: { ...(base.travelPolicy.perDiemRules.applyLodgingByBand), ...(ovr.travelPolicy?.perDiemRules?.applyLodgingByBand||{}) },
    perDiemByBand:      { ...(base.travelPolicy.perDiemRules.perDiemByBand), ...(ovr.travelPolicy?.perDiemRules?.perDiemByBand||{}) },
    perRankByBand:      { ...(base.travelPolicy.perDiemRules.perRankByBand), ...(ovr.travelPolicy?.perDiemRules?.perRankByBand||{}) }
  };
  initTravelMatrixIfNeeded(out.travelPolicy);
  if(ovr.travelPolicy?.matrix){ Object.keys(ovr.travelPolicy.matrix).forEach(o=>{ out.travelPolicy.matrix[o]={ ...(out.travelPolicy.matrix[o]||{}), ...(ovr.travelPolicy.matrix[o]||{}) }; }); }
  if(ovr.travelPolicy?.bandMatrix){ Object.keys(ovr.travelPolicy.bandMatrix).forEach(o=>{ out.travelPolicy.bandMatrix[o]={ ...(out.travelPolicy.bandMatrix[o]||{}), ...(ovr.travelPolicy.bandMatrix[o]||{}) }; }); }
  const js = ovr.jobSessionsPerHead || base.jobSessionsPerHead || {customer:1, nonCustomer:1};
  out.jobSessionsPerHead = { customer:+js.customer||0, nonCustomer:+js.nonCustomer||0 };
  return out;
}
function mergePlans(saved){ const d=getEmptyPlans(); const out={...d}; Object.keys(out).forEach(k=>{ out[k]=(saved[k]||[]).map(x=>JSON.parse(JSON.stringify(x))); }); return out; }

// 저장/로드
function loadState(){ const defaults={ settings:getDefaultSettings(), plans:getEmptyPlans(), nextPlanId:1, simulation:getDefaultSimulation(), onboardingShown:false }; try{ const raw=localStorage.getItem(STORAGE_KEY); if(!raw){ Object.assign(state, defaults); return; } const parsed=JSON.parse(raw); state.settings=mergeSettings(defaults.settings, parsed.settings||{}); state.plans=mergePlans(parsed.plans||{}); state.nextPlanId=parsed.nextPlanId||1; state.simulation=Object.assign(getDefaultSimulation(), parsed.simulation||{}); state.onboardingShown=!!parsed.onboardingShown; }catch(e){ console.warn('상태 복구 실패, 기본값 사용:', e); Object.assign(state, defaults); } }
function persistState(msg){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); if(msg) console.info(msg); }catch(e){ console.warn('저장 실패:', e); } }

// 온보딩/탭
function showOnboarding(){ document.getElementById('onboardingOverlay')?.classList.add('active'); }
function startOnboarding(){ state.onboardingShown=true; persistState(); document.getElementById('onboardingOverlay')?.classList.remove('active'); }
function skipOnboarding(){ state.onboardingShown=true; persistState(); document.getElementById('onboardingOverlay')?.classList.remove('active'); }
function switchTab(event, tabName){ document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active')); if(event?.currentTarget) event.currentTarget.classList.add('active'); const target=document.getElementById(tabName); if(target) target.classList.add('active'); if(tabName==='settings') renderSettings(); if(tabName==='plan') renderPlanEntry(); if(tabName==='summary') renderSummary(); if(tabName==='dashboard') renderDashboard(); if(tabName==='report') renderReport(); updateProgressTracker(); }

// 진행도(간략)
function updateProgressTracker(){ const steps=[ {id:'settings',title:'SETTINGS',desc:'기본/팀/출장 정책'}, {id:'plan',title:'PLAN ENTRY',desc:'계획 입력'}, {id:'summary',title:'SUMMARY',desc:'요약/배분표'}, {id:'dashboard',title:'DASHBOARD',desc:'시각화'}, {id:'report',title:'REPORT',desc:'보고서'} ]; const container=document.getElementById('progressSteps'); if(!container) return; const active=document.querySelector('.tab.active')?.dataset.target; container.innerHTML=steps.map((st,i)=>{ const klass=active===st.id?'in-progress':''; return `<div class="progress-step ${klass}"><div class="progress-step-header"><div class="progress-step-icon">${i+1}</div><div class="progress-step-title">${st.title}</div></div><div class="progress-step-desc">${st.desc}</div></div>`; }).join(''); }

// 탭 플레이스홀더(임시)
function renderPlaceholders(){ const set=(id,title)=>{ const el=document.getElementById(id); if(!el) return; el.innerHTML=`<div class="section-card"><div class="section-header"><div class="description"><h2>${title}</h2><p>기능 복구 중입니다.</p></div></div><div class="empty-placeholder">임시 화면</div></div>`; }; set('settingsContent','SETTINGS'); set('planContent','PLAN ENTRY'); set('summaryContent','SUMMARY'); set('dashboardContent','DASHBOARD'); set('reportContent','REPORT'); }

document.addEventListener('DOMContentLoaded', ()=>{ loadState(); renderSettings(); renderPlanEntry(); renderSummary(); renderDashboard(); renderReport(); updateProgressTracker(); if(!state.onboardingShown) setTimeout(showOnboarding, 350); });

// 임시 window 바인딩(다음 단계에서 대체됨)
Object.assign(window,{ showOnboarding,startOnboarding,skipOnboarding,switchTab,updateProgressTracker });

// Step 2: SETTINGS/CRUD/렌더 구현
function renderSettings(){
  const el=document.getElementById('settingsContent'); if(!el) return;
  const S = state.settings;
  const js = S.jobSessionsPerHead||{customer:1,nonCustomer:1};
  let html = `
  <div class="section-card">
    <div class="section-header"><div class="description">
      <h2>① 기본 설정</h2>
      <p>연도, 통화, 법정의무 예산 등 기준값을 설정합니다.</p>
    </div></div>
    <div class="field-grid">
      <div class="field"><label>연도</label><input type="number" value="${S.year||2026}" onchange="updateSetting('year',this.value)"></div>
      <div class="field"><label>통화</label><input type="text" value="${escapeHtml(S.currency||'KRW')}" onchange="updateSetting('currency',this.value)"></div>
      <div class="field"><label>법정의무 기본예산(원)</label><input type="text" inputmode="numeric" value="${formatNumberInput(S.legalBaseBudget||0)}" onchange="updateSetting('legalBaseBudget',this.value)">${hangulHintHtml(S.legalBaseBudget||0)}</div>
      <div class="field"><label>직무 기타비용 기본값(원)</label><input type="text" inputmode="numeric" value="${formatNumberInput(S.jobDefaultOtherCost||0)}" onchange="updateSetting('jobDefaultOtherCost',this.value)">${hangulHintHtml(S.jobDefaultOtherCost||0)}</div>
      <div class="field"><label>팀배분: 고객사 차수(1인당)</label><input type="number" min="0" step="0.1" value="${js.customer}" onchange="updateSetting('jobSessionsCustomer',this.value)"></div>
      <div class="field"><label>팀배분: 비고객사 차수(1인당)</label><input type="number" min="0" step="0.1" value="${js.nonCustomer}" onchange="updateSetting('jobSessionsNonCustomer',this.value)"></div>
    </div>
  </div>`;
  html += renderLeadershipSection(S);
  html += renderJobSegmentSection(S);
  html += renderHierarchySection(S);
  html += renderLegalSection(S);
  html += renderTravelPolicySection(S);
  html += renderTeamSettingsSection(S);
  el.innerHTML = html;
}

function updateSetting(key,value){
  if(['legalBaseBudget','jobDefaultOtherCost'].includes(key)){
    state.settings[key] = parseNumberInput(value) ?? 0;
  }else if(key==='legalMandatoryShare'){
    const v=parseNumberInput(value); state.settings[key]=(v===null?null:Math.max(0,Math.min(100,v)));
  }else if(key==='year'){
    state.settings.year = Math.max(2024, Math.min(2100, Number(value)||new Date().getFullYear()));
  }else if(key==='currency'){
    state.settings.currency = String(value||'KRW').slice(0,10);
  }else if(key==='jobSessionsCustomer'){
    state.settings.jobSessionsPerHead.customer = Math.max(0, parseNumberInput(value) ?? 0);
  }else if(key==='jobSessionsNonCustomer'){
    state.settings.jobSessionsPerHead.nonCustomer = Math.max(0, parseNumberInput(value) ?? 0);
  }
  persistState(); renderSettings(); updateProgressTracker();
}

// 섹션 렌더러들
function renderLeadershipSection(S){
  const rows=(S.leadershipLevels||[]).map(lv=>`<tr>
    <td><input type="text" value="${escapeHtml(lv.level||'')}" onchange="updateLeadershipLevel('${lv.id}','level',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.unitCost||0)}" onchange="updateLeadershipLevel('${lv.id}','unitCost',this.value)">${hangulHintHtml(lv.unitCost||0)}</td>
    <td><button class="button button-tertiary" onclick="removeLeadershipLevel('${lv.id}')">삭제</button></td>
  </tr>`).join('');
  return `<div class="section-card"><div class="section-header"><div class="description"><h2>② 리더십 레벨</h2><p>계층별 단가</p></div><button class="button button-secondary" onclick="addLeadershipLevel()">+ 추가</button></div><div class="summary-table"><table><thead><tr><th>계층</th><th>단가(원)</th><th>삭제</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function updateLeadershipLevel(id,field,value){ const it=state.settings.leadershipLevels.find(x=>x.id===id); if(!it) return; it[field]=(field==='unitCost'?(parseNumberInput(value)||0):value); persistState(); renderSettings(); }
function removeLeadershipLevel(id){ state.settings.leadershipLevels=state.settings.leadershipLevels.filter(x=>x.id!==id); persistState(); renderSettings(); }
function addLeadershipLevel(){ state.settings.leadershipLevels.push({ id:gen('lead'), level:'새 계층', unitCost:0 }); persistState(); renderSettings(); }

function renderJobSegmentSection(S){
  const rows=(S.jobSegments||[]).map(seg=>`<tr>
    <td><input type="text" value="${escapeHtml(seg.name||'')}" onchange="updateJobSegment('${seg.id}','name',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(seg.ratio||0)}" onchange="updateJobSegment('${seg.id}','ratio',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(seg.unitCost||0)}" onchange="updateJobSegment('${seg.id}','unitCost',this.value)">${hangulHintHtml(seg.unitCost||0)}</td>
    <td><select onchange="updateJobSegment('${seg.id}','category',this.value)"><option value="고객사" ${seg.category==='고객사'?'selected':''}>고객사</option><option value="고객사 외" ${seg.category!=='고객사'?'selected':''}>고객사 외</option></select></td>
    <td><button class="button button-tertiary" onclick="removeJobSegment('${seg.id}')">삭제</button></td>
  </tr>`).join('');
  return `<div class="section-card"><div class="section-header"><div class="description"><h2>③ 직무 교육 세그먼트</h2></div><button class="button button-secondary" onclick="addJobSegment()">+ 추가</button></div><div class="summary-table"><table><thead><tr><th>유형명</th><th>비율(%)</th><th>단가(원)</th><th>카테고리</th><th>삭제</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function updateJobSegment(id,field,value){ const seg=state.settings.jobSegments.find(s=>s.id===id); if(!seg) return; seg[field] = (['ratio','unitCost'].includes(field)? (parseNumberInput(value)||0):value); persistState(); renderSettings(); }
function removeJobSegment(id){ state.settings.jobSegments=state.settings.jobSegments.filter(s=>s.id!==id); persistState(); renderSettings(); }
function addJobSegment(){ state.settings.jobSegments.push({ id:gen('jobseg'), name:'새 유형', ratio:0, unitCost:0, category:'고객사 외' }); persistState(); renderSettings(); }

function renderHierarchySection(S){
  const rows=(S.hierarchyLevels||[]).map(lv=>`<tr>
    <td><input type="text" value="${escapeHtml(lv.level||'')}" onchange="updateHierarchyLevel('${lv.id}','level',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.participation||0)}" onchange="updateHierarchyLevel('${lv.id}','participation',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.unitCost||0)}" onchange="updateHierarchyLevel('${lv.id}','unitCost',this.value)">${hangulHintHtml(lv.unitCost||0)}</td>
    <td><button class="button button-tertiary" onclick="removeHierarchyLevel('${lv.id}')">삭제</button></td>
  </tr>`).join('');
  return `<div class="section-card"><div class="section-header"><div class="description"><h2>④ 직급 공통 교육</h2></div><button class="button button-secondary" onclick="addHierarchyLevel()">+ 추가</button></div><div class="summary-table"><table><thead><tr><th>직급</th><th>참여율(%)</th><th>단가(원)</th><th>삭제</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function updateHierarchyLevel(id,field,value){ const it=state.settings.hierarchyLevels.find(t=>t.id===id); if(!it) return; it[field] = (['participation','unitCost'].includes(field)? (parseNumberInput(value)||0):value); persistState(); renderSettings(); }
function removeHierarchyLevel(id){ state.settings.hierarchyLevels=state.settings.hierarchyLevels.filter(t=>t.id!==id); persistState(); renderSettings(); }
function addHierarchyLevel(){ state.settings.hierarchyLevels.push({ id:gen('hier'), level:'새 직급', participation:0, unitCost:0 }); persistState(); renderSettings(); }

function renderLegalSection(S){
  const rows=(S.legalTypes||[]).map(t=>`<tr>
    <td><input type="text" value="${escapeHtml(t.type||'')}" onchange="updateLegalType('${t.id}','type',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(t.ratio||0)}" onchange="updateLegalType('${t.id}','ratio',this.value)"></td>
    <td><input type="text" inputmode="numeric" value="${formatNumberInput(t.unitCost||0)}" onchange="updateLegalType('${t.id}','unitCost',this.value)">${hangulHintHtml(t.unitCost||0)}</td>
    <td><button class="button button-tertiary" onclick="removeLegalType('${t.id}')">삭제</button></td>
  </tr>`).join('');
  return `<div class="section-card"><div class="section-header"><div class="description"><h2>⑤ 법정의무 교육</h2></div><button class="button button-secondary" onclick="addLegalType()">+ 추가</button></div><div class="summary-table"><table><thead><tr><th>항목</th><th>비율(%)</th><th>단가(원)</th><th>삭제</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function updateLegalType(id,field,value){ const it=state.settings.legalTypes.find(t=>t.id===id); if(!it) return; it[field]= (['ratio','unitCost'].includes(field)? (parseNumberInput(value)||0):value); persistState(); renderSettings(); }
function removeLegalType(id){ state.settings.legalTypes=state.settings.legalTypes.filter(t=>t.id!==id); persistState(); renderSettings(); }
function addLegalType(){ state.settings.legalTypes.push({ id:gen('legal'), type:'새 항목', ratio:0, unitCost:0 }); persistState(); renderSettings(); }

// Travel/Teams
function firstOriginName(){ return state.settings.travelPolicy.origins[0]?.name || '본사(영천)'; }
function firstDestinationName(){ return state.settings.travelPolicy.destinations[0]?.name || '서울'; }
function initTravelRowsFor(name){ const tp=state.settings.travelPolicy; if(!tp.matrix[name]) tp.matrix[name]={}; if(!tp.bandMatrix[name]) tp.bandMatrix[name]={}; }
function renderTravelPolicySection(S){ const tp=S.travelPolicy; initTravelMatrixIfNeeded(tp); const originNames=tp.origins.map(o=>o.name); const dests=tp.destinations; const bandBadge=b=> b==='근거리'?'<span class="pill">근거리</span>':'<span class="pill">원거리</span>'; const r=tp.perDiemRules; return `
  <div class="section-card">
    <div class="section-header"><div class="description"><h2>⑥ 출장비 정책 (출발지 × 목적지)</h2><p>요금과 근거리여부를 관리합니다.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="button button-secondary" onclick="addOrigin()">+ 출발지</button>
        <button class="button button-secondary" onclick="addDestination()">+ 목적지</button>
        <button class="button button-primary" onclick="triggerTravelXlsx()">교통비.xlsx 업로드</button>
        <input id="travelXlsxInput" type="file" accept=".xlsx" style="display:none" onchange="handleTravelXlsx(event)">
      </div>
    </div>
    <div class="sub-table"><h4>출발지 목록</h4><div class="summary-table"><table><thead><tr><th>출발지명</th><th>삭제</th></tr></thead><tbody>${tp.origins.map(o=>`<tr><td><input type=\"text\" value=\"${escapeHtml(o.name)}\" onchange=\"updateOriginName('${o.id}',this.value)\"></td><td><button class=\"button button-tertiary\" onclick=\"removeOrigin('${o.id}')\">삭제</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="sub-table" style="margin-top:12px"><h4>목적지 목록</h4><div class="summary-table"><table><thead><tr><th>목적지명</th><th>기본 권역</th><th>표시</th><th>삭제</th></tr></thead><tbody>${dests.map(d=>`<tr><td><input type=\"text\" value=\"${escapeHtml(d.name)}\" onchange=\"updateDestinationField('${d.id}','name',this.value)\"></td><td><select onchange=\"updateDestinationField('${d.id}','band',this.value)\"><option value=\"근거리\" ${d.band==='근거리'?'selected':''}>근거리</option><option value=\"원거리\" ${d.band==='원거리'?'selected':''}>원거리</option></select></td><td>${bandBadge(d.band)}</td><td><button class=\"button button-tertiary\" onclick=\"removeDestination('${d.id}')\">삭제</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="sub-table" style="margin-top:12px"><h4>요금표/권역</h4><div class="summary-table travel-matrix"><table><thead><tr><th>출발지 \\ 목적지</th>${dests.map(d=>`<th>${escapeHtml(d.name)}<div class=\"mini\">${bandBadge(d.band)}</div></th>`).join('')}</tr></thead><tbody>${originNames.map(on=>{ const rowAmt=tp.matrix[on]||{}; const rowBand=(tp.bandMatrix||{})[on]||{}; return `<tr><td><strong>${escapeHtml(on)}</strong></td>${dests.map(d=>{ const val=rowAmt[d.name]??0; const band=rowBand[d.name]||d.band||'근거리'; return `<td><div style=\"display:grid;gap:6px\"><div><input type=\"text\" inputmode=\"numeric\" value=\"${formatNumberInput(val)}\" onchange=\"updateMatrixAmount('${escapeHtml(on)}','${escapeHtml(d.name)}',this.value)\">${hangulHintHtml(val)}</div><div><select onchange=\"updateMatrixBand('${escapeHtml(on)}','${escapeHtml(d.name)}',this.value)\"><option value=\"근거리\" ${band==='근거리'?'selected':''}>근거리</option><option value=\"원거리\" ${band==='원거리'?'selected':''}>원거리</option></select></div></div></td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div></div>
    <div class="sub-table" style="margin-top:12px"><h4>Per-Diem/숙박</h4><div class="field-grid"><div class="field"><label>근거리 Per-Diem(원)</label><input type="text" inputmode="numeric" value="${formatNumberInput(r.perDiemByBand['근거리'])}" onchange="updatePerDiemRule('perDiemNear',this.value)">${hangulHintHtml(r.perDiemByBand['근거리'])}</div><div class="field"><label>원거리 Per-Diem(원)</label><input type="text" inputmode="numeric" value="${formatNumberInput(r.perDiemByBand['원거리'])}" onchange="updatePerDiemRule('perDiemFar',this.value)">${hangulHintHtml(r.perDiemByBand['원거리'])}</div><div class="field"><label>숙박비(1박, 원)</label><input type="text" inputmode="numeric" value="${formatNumberInput(r.lodgingPerNight)}" onchange="updatePerDiemRule('lodgingPerNight',this.value)">${hangulHintHtml(r.lodgingPerNight)}</div><div class="field"><label>기본 숙박 박수</label><input type="number" min="0" value="${r.defaultNights}" onchange="updatePerDiemRule('defaultNights',this.value)"></div></div></div>
  </div>`; }

function addOrigin(){ const name=`출발지${state.settings.travelPolicy.origins.length+1}`; state.settings.travelPolicy.origins.push({id:gen('org'),name}); initTravelRowsFor(name); persistState(); renderSettings(); }
function removeOrigin(id){ const tp=state.settings.travelPolicy; const o=tp.origins.find(x=>x.id===id); if(!o) return; delete tp.matrix[o.name]; delete tp.bandMatrix[o.name]; tp.origins=tp.origins.filter(x=>x.id!==id); const fb=firstOriginName(); state.settings.teams=state.settings.teams.map(t=>({...t,origin: tp.origins.some(y=>y.name===t.origin)?t.origin:fb})); persistState(); renderSettings(); }
function updateOriginName(id,value){ const tp=state.settings.travelPolicy; const origin=tp.origins.find(x=>x.id===id); if(!origin) return; const prev=origin.name; const next=String(value||'').trim()||prev; if(prev===next) return; origin.name=next; tp.matrix[next]={...(tp.matrix[prev]||{})}; delete tp.matrix[prev]; tp.bandMatrix[next]={...(tp.bandMatrix[prev]||{})}; delete tp.bandMatrix[prev]; state.settings.teams.forEach(t=>{ if(t.origin===prev) t.origin=next; }); persistState(); renderSettings(); }

function addDestination(){ const name=`목적지${state.settings.travelPolicy.destinations.length+1}`; const tp=state.settings.travelPolicy; tp.destinations.push({id:gen('dst'),name,band:'근거리'}); initTravelMatrixIfNeeded(tp); Object.keys(tp.matrix).forEach(o=>{ if(tp.matrix[o][name]===undefined) tp.matrix[o][name]=20000; if((tp.bandMatrix[o]||{})[name]===undefined){ if(!tp.bandMatrix[o]) tp.bandMatrix[o]={}; tp.bandMatrix[o][name]='근거리'; } }); persistState(); renderSettings(); }
function removeDestination(id){ const tp=state.settings.travelPolicy; const d=tp.destinations.find(x=>x.id===id); if(!d) return; const name=d.name; tp.destinations=tp.destinations.filter(x=>x.id!==id); Object.keys(tp.matrix).forEach(o=>{ delete tp.matrix[o][name]; if(tp.bandMatrix[o]) delete tp.bandMatrix[o][name]; }); const fb=firstDestinationName(); state.settings.teams=state.settings.teams.map(t=>({ ...t, customerDestination:(t.customerDestination===name?fb:t.customerDestination), nonCustomerDestination:(t.nonCustomerDestination===name?fb:t.nonCustomerDestination) })); persistState(); renderSettings(); }
function updateDestinationField(id,field,value){ const tp=state.settings.travelPolicy; const d=tp.destinations.find(x=>x.id===id); if(!d) return; const prev=d.name; if(field==='name'){ const next=String(value||'').trim()||prev; if(next===prev) return; d.name=next; Object.keys(tp.matrix).forEach(o=>{ const row=tp.matrix[o]; row[next]=row[prev]; delete row[prev]; const brow=tp.bandMatrix[o]; if(brow){ brow[next]=brow[prev]; delete brow[prev]; } }); state.settings.teams.forEach(t=>{ if(t.customerDestination===prev) t.customerDestination=next; if(t.nonCustomerDestination===prev) t.nonCustomerDestination=next; }); } else if(field==='band'){ d.band=value==='원거리'?'원거리':'근거리'; } persistState(); renderSettings(); }

function updateMatrixAmount(originName,destName,value){ const tp=state.settings.travelPolicy; if(!tp.matrix[originName]) tp.matrix[originName]={}; tp.matrix[originName][destName]=parseNumberInput(value)??0; persistState(); }
function updateMatrixBand(originName,destName,value){ const tp=state.settings.travelPolicy; if(!tp.bandMatrix[originName]) tp.bandMatrix[originName]={}; tp.bandMatrix[originName][destName]=(value==='원거리'?'원거리':'근거리'); persistState(); }
function updatePerDiemRule(field,value){ const r=state.settings.travelPolicy.perDiemRules; if(field==='lodgingPerNight'||field==='defaultNights'){ r[field]=Math.max(0,parseNumberInput(value)??0);} else if(field==='perDiemNear'){ r.perDiemByBand['근거리']=Math.max(0,parseNumberInput(value)??0);} else if(field==='perDiemFar'){ r.perDiemByBand['원거리']=Math.max(0,parseNumberInput(value)??0);} persistState(); }

function renderTeamSettingsSection(S){ const tp=S.travelPolicy; const originOpts=tp.origins.map(o=>o.name); const destOpts=tp.destinations.map(d=>d.name); const options=(list,curr)=> list.map(x=>`<option value="${escapeHtml(x)}" ${x===curr?'selected':''}>${escapeHtml(x)}</option>`).join(''); const rowsHtml=(S.teams||[]).map(t=>{ const jobBudget=+t.jobBudgetManual||0; return `<tr><td><input type=\"text\" value=\"${escapeHtml(t.name||'')}\" onchange=\"updateTeam('${t.id}','name',this.value)\"></td><td><input type=\"number\" min=\"0\" value=\"${t.headcount||0}\" onchange=\"updateTeam('${t.id}','headcount',this.value)\"></td><td><select onchange=\"updateTeam('${t.id}','origin',this.value)\">${options(originOpts,t.origin||firstOriginName())}</select></td><td><select onchange=\"updateTeam('${t.id}','rankLevel',this.value)\"><option>사원</option><option ${t.rankLevel==='대리'?'selected':''}>대리</option><option ${t.rankLevel==='과·차 이상'?'selected':''}>과·차 이상</option></select></td><td><input type=\"number\" min=\"0\" max=\"100\" step=\"1\" value=\"${t.customerSharePct||0}\" onchange=\"updateTeam('${t.id}','customerSharePct',this.value)\"></td><td><select onchange=\"updateTeam('${t.id}','customerDestination',this.value)\">${options(destOpts,t.customerDestination||firstDestinationName())}</select></td><td><select onchange=\"updateTeam('${t.id}','nonCustomerDestination',this.value)\">${options(destOpts,t.nonCustomerDestination||firstDestinationName())}</select></td><td><input type=\"text\" inputmode=\"numeric\" value=\"${formatNumberInput(jobBudget)}\" onfocus=\"this.value=this.value.replace(/,/g,'')\" onblur=\"(function(el){const v=parseNumberInput(el.value)||0;updateTeam('${t.id}','jobBudgetManual',v);el.value=formatNumberInput(v);})(this)\"><div class=\"krw-hint\" style=\"font-size:.8em;color:#9cb5e9;margin-top:4px;\">${toKoreanCurrencyShort(jobBudget)}</div></td><td><button class=\"button button-tertiary\" onclick=\"removeTeam('${t.id}')\">삭제</button></td></tr>`; }).join(''); return `<div class="section-card"><div class="section-header"><div class="description"><h2>⑦ Teams (배분 대상)</h2></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-secondary" onclick="downloadTeamsTemplate()">템플릿 다운로드(CSV)</button><button class="button button-secondary" onclick="exportTeamsToCSV()">현재 Teams 내보내기(CSV)</button><button class="button button-primary" onclick="triggerTeamsUpload()">업로드(CSV)</button><input id="teamsFileInput" type="file" accept=".csv" style="display:none" onchange="handleTeamsFile(event)"><button class="button button-tertiary" onclick="addTeam()">+ 팀 추가</button></div></div><div class="summary-table"><table><thead><tr><th>팀명</th><th>인원</th><th>출발지</th><th>주요 직급</th><th>고객사 비중(%)</th><th>고객사 목적지</th><th>비고객사 목적지</th><th>직무교육비(직접배부)</th><th>삭제</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`; }
function updateTeam(id,field,value){ const t=state.settings.teams.find(x=>x.id===id); if(!t) return; if(['headcount','customerSharePct','jobBudgetManual'].includes(field)) t[field]=Math.max(0,parseNumberInput(value)??0); else t[field]=value; if(field==='customerSharePct') t[field]=Math.min(100,t[field]); persistState(); renderSettings(); }
function addTeam(){ state.settings.teams.push({ id:gen('team'), name:'새 팀', headcount:0, origin:firstOriginName(), rankLevel:'사원', customerSharePct:50, customerDestination:firstDestinationName(), nonCustomerDestination:firstDestinationName(), jobBudgetManual:0 }); persistState(); renderSettings(); }
function removeTeam(id){ state.settings.teams=state.settings.teams.filter(t=>t.id!==id); persistState(); renderSettings(); }

Object.assign(window, { updateSetting, addLeadershipLevel, removeLeadershipLevel, updateLeadershipLevel, addJobSegment, removeJobSegment, updateJobSegment, addHierarchyLevel, removeHierarchyLevel, updateHierarchyLevel, addLegalType, removeLegalType, updateLegalType, addOrigin, removeOrigin, updateOriginName, addDestination, removeDestination, updateDestinationField, updateMatrixAmount, updateMatrixBand, updatePerDiemRule, addTeam, removeTeam, updateTeam });

// Step 3: PLAN ENTRY, SUMMARY, 계산 로직
function renderPlanEntry(){ const el=document.getElementById('planContent'); if(!el) return; el.innerHTML = `
  <div class="section-card">
    <div class="section-header"><div class="description">
      <h2>PLAN ENTRY</h2><p>트랙별 계획(인원×차수×단가)을 입력합니다.</p>
    </div></div>
    ${renderPlanTable('leadership','리더십',['계층','인원','차수','단가(원)'])}
    ${renderPlanTable('job','직무',['과정명','인원','차수','가중평균단가(원)','기타비용(원)','참고'])}
    ${renderPlanTable('hierarchy','직급공통',['직급','인원','차수','단가(원)'])}
    ${renderPlanTable('legal','법정',['항목','인원','차수','단가(원)'])}
    ${renderPlanTable('misc','기타',['항목','인원','차수','단가(원)','비고'])}
  </div>`; }
function renderPlanTable(key,title,headers){ const rows=(state.plans[key]||[]); return `<div class="plan-card"><div class="plan-card-header"><h3>${title} 계획</h3><button class="button button-secondary" onclick="addPlanRow('${key}')">+ 추가</button></div><div class="summary-table"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}<th>삭제</th></tr></thead><tbody>${rows.map(r=>planRowHtml(key,r)).join('')}</tbody></table></div></div>`; }
function planRowHtml(key,r){ const text=(v,cb)=>`<input type="text" value="${escapeHtml(v||'')}" onchange="${cb}(this.value)">`; const num=(v,cb)=>`<div><input type="text" inputmode="numeric" value="${formatNumberInput(v||0)}" onchange="${cb}(this.value)">${hangulHintHtml(v||0)}</div>`; if(key==='leadership') return `<tr><td>${text(r.level,`updatePlanField('${key}','${r.id}','level')`)}</td><td>${num(r.headcount,`updatePlanNumber('${key}','${r.id}','headcount')`)}</td><td>${num(r.rounds,`updatePlanNumber('${key}','${r.id}','rounds')`)}</td><td>${num(r.unitCost,`updatePlanNumber('${key}','${r.id}','unitCost')`)}</td><td><button class="button button-tertiary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`; if(key==='job') return `<tr><td>${text(r.name,`updatePlanField('${key}','${r.id}','name')`)}</td><td>${num(r.headcount,`updatePlanNumber('${key}','${r.id}','headcount')`)}</td><td>${num(r.rounds,`updatePlanNumber('${key}','${r.id}','rounds')`)}</td><td>${num(r.unitCost,`updatePlanNumber('${key}','${r.id}','unitCost')`)}</td><td>${num(coalesce(r.otherCost,state.settings.jobDefaultOtherCost),`updatePlanNumber('${key}','${r.id}','otherCost')`)}</td><td class="note">팀 배분은 Settings▶Teams 사용</td><td><button class="button button-ter티ary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`; if(key==='hierarchy') return `<tr><td>${text(r.level,`updatePlanField('${key}','${r.id}','level')`)}</td><td>${num(r.headcount,`updatePlanNumber('${key}','${r.id}','headcount')`)}</td><td>${num(r.rounds,`updatePlanNumber('${key}','${r.id}','rounds')`)}</td><td>${num(r.unitCost,`updatePlanNumber('${key}','${r.id}','unitCost')`)}</td><td><button class="button button-ter티ary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`; if(key==='legal') return `<tr><td>${text(r.type,`updatePlanField('${key}','${r.id}','type')`)}</td><td>${num(r.headcount,`updatePlanNumber('${key}','${r.id}','headcount')`)}</td><td>${num(r.rounds,`updatePlanNumber('${key}','${r.id}','rounds')`)}</td><td>${num(r.unitCost,`updatePlanNumber('${key}','${r.id}','unitCost')`)}</td><td><button class="button button-ter티ary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`; return `<tr><td>${text(r.name,`updatePlanField('${key}','${r.id}','name')`)}</td><td>${num(r.headcount,`updatePlanNumber('${key}','${r.id}','headcount')`)}</td><td>${num(r.rounds,`updatePlanNumber('${key}','${r.id}','rounds')`)}</td><td>${num(r.unitCost,`updatePlanNumber('${key}','${r.id}','unitCost')`)}</td><td>${text(r.note||'',`updatePlanField('${key}','${r.id}','note')`)}</td><td><button class="button button-ter티ary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`; }
function addPlanRow(key){ const base={ id:gen('plan'), headcount:0, rounds:1, unitCost:0 }; if(key==='leadership') state.plans.leadership.push({ ...base, level:'중간관리자' }); else if(key==='job') state.plans.job.push({ ...base, name:'직무 과정', otherCost: state.settings.jobDefaultOtherCost }); else if(key==='hierarchy') state.plans.hierarchy.push({ ...base, level:'사원' }); else if(key==='legal') state.plans.legal.push({ ...base, type:'산업안전' }); else state.plans.misc.push({ ...base, name:'기타', note:'' }); persistState(); renderPlanEntry(); renderSummary(); updateProgressTracker(); }
function removePlanRow(key,id){ state.plans[key]=(state.plans[key]||[]).filter(r=>r.id!==id); persistState(); renderPlanEntry(); renderSummary(); updateProgressTracker(); }
function updatePlanField(key,id,field,value){ const row=(state.plans[key]||[]).find(r=>r.id===id); if(!row) return; row[field]=value; persistState(); renderSummary(); }
function updatePlanNumber(key,id,field,value){ const row=(state.plans[key]||[]).find(r=>r.id===id); if(!row) return; row[field]=parseNumberInput(value)??0; persistState(); renderSummary(); }

// 계산
function weightedAverageUnitCost(segments){ return sum((segments||[]).map(s=>((+s.ratio||0)/100)*(+s.unitCost||0))); }
function weightedAvgByCategory(segments){ const acc={고객사:{num:0,den:0},'고객사 외':{num:0,den:0}}; (segments||[]).forEach(s=>{ const r=(+s.ratio||0), u=(+s.unitCost||0), c=(s.category==='고객사'?'고객사':'고객사 외'); acc[c].num+=(r*u); acc[c].den+=r; }); const unitCustomer=acc['고객사'].den>0?(acc['고객사'].num/acc['고객사'].den):0; const unitNonCustomer=acc['고객사 외'].den>0?(acc['고객사 외'].num/acc['고객사 외'].den):0; return {unitCustomer,unitNonCustomer}; }
function computeJobTrack(rows,S){ const weightedUnit=weightedAverageUnitCost(S.jobSegments||[]); const items=(rows||[]).map(r=>{ const head=+r.headcount||0, rounds=+r.rounds||0; const unit=+r.unitCost||weightedUnit; const other=+coalesce(r.otherCost,S.jobDefaultOtherCost)||0; const raw=(head*rounds*unit)+other; return { id:r.id, cost:roundWon(raw), head, rounds, unit, other }; }); return { items, total:sum(items.map(i=>i.cost)), weightedUnit } }
function computeSimpleTrack(rows){ const items=(rows||[]).map(r=>{ const head=+r.headcount||0, rounds=+r.rounds||0, unit=+r.unitCost||0; const raw=head*rounds*unit; return { id:r.id, cost:roundWon(raw), head, rounds, unit }; }); return { items, total:sum(items.map(i=>i.cost)) } }
function getBandForPair(tp,originName,destName){ const row=(tp.bandMatrix||{})[originName]||{}; const d=tp.destinations.find(x=>x.name===destName); return row[destName]||d?.band||'근거리'; }
function travelCostFor(tp,originName,destName){ const base=+(((tp.matrix||{})[originName]||{})[destName]||0); const band=getBandForPair(tp,originName,destName); const r=tp.perDiemRules; const perDiem=+r.perDiemByBand[band]||0; const lodging=r.applyLodgingByBand[band]? ((+r.lodgingPerNight||0)*(+r.defaultNights||0)) : 0; return base+perDiem+lodging; }
function computeTeamAllocations(S){ const {unitNonCustomer}=weightedAvgByCategory(S.jobSegments||[]); const tp=S.travelPolicy; initTravelMatrixIfNeeded(tp); const js=S.jobSessionsPerHead||{customer:1,nonCustomer:1}; const rows=(S.teams||[]).map(t=>{ const head=+t.headcount||0; const sC=+js.customer||0; const sN=+js.nonCustomer||0; const tuition=roundWon(head*sN*unitNonCustomer); const costC=roundWon(travelCostFor(tp,t.origin,t.customerDestination||'')*head*sC); const costN=roundWon(travelCostFor(tp,t.origin,t.nonCustomerDestination||'')*head*sN); const travel=roundWon(costC+costN); const total=roundWon(tuition+travel); return { id:t.id, team:t.name, headcount:head, origin:t.origin, customerDestination:t.customerDestination, nonCustomerDestination:t.nonCustomerDestination, sessionsCustomer:sC, sessionsNonCustomer:sN, unitNonCustomer, tuition, travel, total }; }); const totals={ tuition:roundWon(sum(rows.map(r=>r.tuition))), travel:roundWon(sum(rows.map(r=>r.travel))), total:roundWon(sum(rows.map(r=>r.total))) }; return { rows, totals, sessions:S.jobSessionsPerHead } }
function aggregateTotals(s){ const tb={ leadership:s.leadership.total, job:s.job.total, hierarchy:s.hierarchy.total, legal:s.legal.total, misc:s.misc.total }; const totalByTrack=Object.fromEntries(Object.entries(tb).map(([k,v])=>[k,v||0])); return { totalByTrack, overallBudget: sum(Object.values(totalByTrack)) } }

function renderSummary(){ const el=document.getElementById('summaryContent'); if(!el) return; const sums={ leadership:computeSimpleTrack(state.plans.leadership||[]), job:computeJobTrack(state.plans.job||[], state.settings), hierarchy:computeSimpleTrack(state.plans.hierarchy||[]), legal:computeSimpleTrack(state.plans.legal||[]), misc:computeSimpleTrack(state.plans.misc||[]), teamAlloc:computeTeamAllocations(state.settings) }; const totals=aggregateTotals(sums); const alloc=sums.teamAlloc; let html=`<div class="section-card"><div class="section-header"><div class="description"><h2>SUMMARY</h2><p><b>팀별 자동 배분(안)</b>: 고객사=출장비만, 비고객사=교육비+'고객사 외' 가중단가 + 출장비.</p></div></div><div class="metrics-grid">${Object.entries(totals.totalByTrack).map(([k,v])=>`<div class=\"metric-card\"><h4>${k}</h4><p>${formatNumberInput(v)} 원<br><span class=\"mini\">${toKoreanCurrencyShort(v)}</span></p></div>`).join('')}<div class="metric-card"><h4>전체 합계</h4><p>${formatNumberInput(totals.overallBudget)} 원<br><span class="mini">${toKoreanCurrencyShort(totals.overallBudget)}</span></p></div></div>`; html+=`<div class="summary-table" style="margin-top:14px;"><h3>팀별 직무교육비 배분(안)</h3><table><thead><tr><th>팀</th><th>인원</th><th>출발지</th><th>고객사 목적지</th><th>고객사 차수</th><th>비고객사 목적지</th><th>비고객사 차수</th><th>수강료 합계</th><th>출장비 합계</th><th>배분 합계</th></tr></thead><tbody>${(alloc.rows||[]).map(r=>`<tr><td>${escapeHtml(r.team||'')}</td><td>${formatNumberInput(r.headcount)}</td><td>${escapeHtml(r.origin||'')}</td><td>${escapeHtml(r.customerDestination||'')}</td><td>${r.sessionsCustomer}</td><td>${escapeHtml(r.nonCustomerDestination||'')}</td><td>${r.sessionsNonCustomer}</td><td>${formatNumberInput(r.tuition)} 원<br><span class=\"mini\">${toKoreanCurrencyShort(r.tuition)}</span></td><td>${formatNumberInput(r.travel)} 원<br><span class=\"mini\">${toKoreanCurrencyShort(r.travel)}</span></td><td><strong>${formatNumberInput(r.total)} 원</strong><br><span class=\"mini\">${toKoreanCurrencyShort(r.total)}</span></td></tr>`).join('')}</tbody><tfoot><tr><th colspan="7" style="text-align:right;">합계</th><th>${formatNumberInput(alloc.totals.tuition)} 원<br><span class="mini">${toKoreanCurrencyShort(alloc.totals.tuition)}</span></th><th>${formatNumberInput(alloc.totals.travel)} 원<br><span class="mini">${toKoreanCurrencyShort(alloc.totals.travel)}</span></th><th>${formatNumberInput(alloc.totals.total)} 원<br><span class="mini">${toKoreanCurrencyShort(alloc.totals.total)}</span></th></tr></tfoot></table></div>`; html+=renderJobBudgetCompareSection(); el.innerHTML=html; }

function getTeamAllocatedJobBudgetTotal(){ const teams=(state.settings?.teams)||[]; return teams.reduce((acc,t)=>acc+Number(t.jobBudgetManual||0),0); }
function getJobTrackExpectedCost(){ const job=computeJobTrack(state.plans.job||[], state.settings); return job.total||0; }
function renderJobBudgetCompareSection(){ const trackCost=getJobTrackExpectedCost(); const teamAlloc=getTeamAllocatedJobBudgetTotal(); const diff=teamAlloc-trackCost; const line=(k,v,b=false)=>`<tr${b?' style=\"font-weight:700\"':''}><td>${k}</td><td style=\"text-align:right\">${formatNumberInput(v)} 원</td><td style=\"text-align:right;color:#6b7280\">${toKoreanCurrencyShort(v)}</td></tr>`; return `<div class="section-card"><div class="section-header"><div class="description"><h2>직무교육비 요약 (트랙 예상 vs 팀별 배부)</h2></div></div><div class="summary-table"><table><thead><tr><th>구분</th><th style="text-align:right">금액(원)</th><th style="text-align:right">한글 금액</th></tr></thead><tbody>${line('① 직무 트랙 예상비용(PLAN 기반)',trackCost)}${line('② 팀별 직무교육비(직접배부 합계)',teamAlloc)}${line('③ 차이(②-①)',diff,true)}</tbody></table></div></div>`; }

function renderDashboard(){ const el=document.getElementById('dashboardContent'); if(!el) return; el.innerHTML = `<div class="section-card"><div class="section-header"><div class="description"><h2>DASHBOARD</h2><p>추후 차트 연동</p></div></div><div class="empty-placeholder">차트 구성 예정</div></div>`; }
function renderReport(){ const el=document.getElementById('reportContent'); if(!el) return; el.innerHTML = `<div class="section-card"><div class="section-header"><div class="description"><h2>REPORT</h2><p>경영 보고용 요약.</p></div></div><div class="report-container"><div class="report-title">교육비 사업계획(요약)</div><div class="report-subtitle">${state.settings.year||''}년 / 통화: ${escapeHtml(state.settings.currency||'KRW')}</div><div class="note">SUMMARY 기준.</div></div></div>`; }

Object.assign(window,{ renderPlanEntry, renderSummary });

// Step 4: CSV/XLSX 유틸 및 핸들러
function downloadText(text, filename, mime){ const blob=new Blob([text],{type:mime||'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename||'download.txt'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function escapeCsv(s){ s=String(s??''); if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`; return s; }
function splitCsv(line, expected){ const out=[]; let cur='', inQ=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(inQ){ if(ch==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else inQ=false; } else cur+=ch; } else { if(ch===','){ out.push(cur); cur=''; } else if(ch==='"'){ inQ=true; } else cur+=ch; } } out.push(cur); if(expected) while(out.length<expected) out.push(''); return out; }
async function decodeArrayBufferSmart(ab){ const d=new TextDecoder('utf-8',{fatal:false}); const text=d.decode(ab); return (text && text.charCodeAt(0)===0xFEFF)? text.slice(1) : text; }

function downloadTeamsTemplate(){ const headers=['name','headcount','origin','rankLevel','customerSharePct','customerDestination','nonCustomerDestination','jobBudgetManual']; const sample=[ ['생산1팀','60','본사(영천)','사원','70','울산','서울','0'] ]; const csv=[headers.join(','), ...sample.map(r=>r.join(','))].join('\r\n'); downloadText(csv,'teams_template.csv','text/csv'); }
function exportTeamsToCSV(){ const headers=['name','headcount','origin','rankLevel','customerSharePct','customerDestination','nonCustomerDestination','jobBudgetManual']; const rows=(state.settings.teams||[]).map(t=>[ t.name||'', String(t.headcount||0), t.origin||'', t.rankLevel||'사원', String(t.customerSharePct||0), t.customerDestination||'', t.nonCustomerDestination||'', String(t.jobBudgetManual||0) ]); const csv=[headers.join(','), ...rows.map(r=>r.map(escapeCsv).join(','))].join('\r\n'); downloadText(csv,`teams_export_${state.settings.year||''}.csv`,'text/csv'); }
function triggerTeamsUpload(){ document.getElementById('teamsFileInput')?.click(); }
function handleTeamsFile(evt){ const file=evt.target.files?.[0]; if(!file) return; const reader=new FileReader(); reader.onload=async ()=>{ try{ const text=await decodeArrayBufferSmart(reader.result); const lines=text.split(/\r?\n/).filter(x=>x.trim().length>0); if(!lines.length){ alert('빈 CSV'); evt.target.value=''; return; } const headers=splitCsv(lines.shift()).map(x=>x.trim()); const idx=(k)=>headers.indexOf(k); const need=['name','headcount','origin','rankLevel','customerSharePct','customerDestination','nonCustomerDestination','jobBudgetManual']; const missing=need.filter(k=>idx(k)===-1); if(missing.length){ alert('CSV 헤더 누락: '+missing.join(', ')); evt.target.value=''; return; } const rows=lines.map(line=>{ const cols=splitCsv(line, headers.length); return { name:(cols[idx('name')]||'').trim(), headcount:cols[idx('headcount')], origin:(cols[idx('origin')]||'').trim(), rankLevel:(cols[idx('rankLevel')]||'사원').trim(), customerSharePct:cols[idx('customerSharePct')], customerDestination:(cols[idx('customerDestination')]||'').trim(), nonCustomerDestination:(cols[idx('nonCustomerDestination')]||'').trim(), jobBudgetManual:cols[idx('jobBudgetManual')] }; }); applyTeamRows(rows); evt.target.value=''; }catch(e){ console.error(e); alert('CSV 파싱 오류'); evt.target.value=''; } }; reader.readAsArrayBuffer(file); }
function applyTeamRows(rows){ const tp=state.settings.travelPolicy; initTravelMatrixIfNeeded(tp); const ensureOrigin=(name)=>{ if(!tp.origins.some(o=>o.name===name)){ tp.origins.push({id:gen('org'),name}); if(!tp.matrix[name]) tp.matrix[name]={}; if(!tp.bandMatrix[name]) tp.bandMatrix[name]={}; } }; const ensureDest=(name,band='근거리')=>{ if(!tp.destinations.some(d=>d.name===name)){ tp.destinations.push({id:gen('dst'),name,band}); Object.keys(tp.matrix).forEach(o=>{ if(!tp.matrix[o]) tp.matrix[o]={}; if(!tp.bandMatrix[o]) tp.bandMatrix[o]={}; tp.matrix[o][name]=tp.matrix[o][name]??20000; tp.bandMatrix[o][name]=tp.bandMatrix[o][name]??band; }); } }; const teams=[]; rows.forEach(r=>{ const name=String(r.name||'').trim(); if(!name) return; const head=Math.max(0,parseNumberInput(r.headcount)||0); const origin=String(r.origin||firstOriginName()).trim(); const rank=['사원','대리','과·차 이상'].includes(r.rankLevel)?r.rankLevel:'사원'; const share=Math.max(0,Math.min(100,parseNumberInput(r.customerSharePct)||0)); const dstC=String(r.customerDestination||firstDestinationName()).trim(); const dstN=String(r.nonCustomerDestination||firstDestinationName()).trim(); const manual=Math.max(0,parseNumberInput(r.jobBudgetManual)||0); ensureOrigin(origin); ensureDest(dstC); ensureDest(dstN); teams.push({ id:gen('team'), name, headcount:head, origin, rankLevel:rank, customerSharePct:share, customerDestination:dstC, nonCustomerDestination:dstN, jobBudgetManual:manual }); }); state.settings.teams=teams; persistState('Teams 업로드 완료'); renderSettings(); renderSummary(); }

function triggerTravelXlsx(){ document.getElementById('travelXlsxInput')?.click(); }
function handleTravelXlsx(evt){ const file=evt.target.files?.[0]; if(!file) return; if(typeof XLSX==='undefined'){ alert('xlsx 라이브러리를 불러오지 못했습니다.'); evt.target.value=''; return; } const reader=new FileReader(); reader.onload=(e)=>{ try{ const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'}); const ws=wb.Sheets['교통비']||wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws); const tp=state.settings.travelPolicy; initTravelMatrixIfNeeded(tp); rows.forEach(r=>{ const origin=String(r['출발지']||'').trim(); const dest=String(r['출장지역']||'').trim(); if(!origin||!dest) return; const car=parseNumberInput(r['자차교통비(왕복)'])||0; const publicT=parseNumberInput(r['대중교통비(왕복)']); const fare=Number.isFinite(publicT)&&publicT>0?publicT:car; const nearFlag=String(r['근거리여부']||'').trim(); const band=(nearFlag==='O'||nearFlag==='o'||nearFlag==='Y')?'근거리':'원거리'; if(!tp.origins.some(o=>o.name===origin)) tp.origins.push({id:gen('org'),name:origin}); if(!tp.destinations.some(d=>d.name===dest)) tp.destinations.push({id:gen('dst'),name:dest,band}); if(!tp.matrix[origin]) tp.matrix[origin]={}; if(!tp.bandMatrix[origin]) tp.bandMatrix[origin]={}; tp.matrix[origin][dest]=fare; tp.bandMatrix[origin][dest]=band; }); initTravelMatrixIfNeeded(tp); persistState('교통비.xlsx 적용 완료'); renderSettings(); renderSummary(); }catch(err){ console.error(err); alert('교통비.xlsx 파싱 오류'); } finally { evt.target.value=''; } }; reader.readAsArrayBuffer(file); }

Object.assign(window,{ downloadTeamsTemplate, exportTeamsToCSV, triggerTeamsUpload, handleTeamsFile, triggerTravelXlsx, handleTravelXlsx });
