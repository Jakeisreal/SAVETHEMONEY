/* script.js - 교육비 사업계획 플래너 (교통비.xlsx + 직급별 Per-Diem 반영 통합본)
 * - SETTINGS: 교통비.xlsx 업로드 → 출발지×목적지 요금/권역 자동반영
 * - Per-Diem: 원거리 시 직급별(사원/대리/과·차 이상) 금액 적용, 근거리는 밴드별 일당/숙박 토글 유지
 * - Teams: '주요 직급' 컬럼 추가(사원/대리/과·차 이상)
 * - SUMMARY: 고객사(출장비만) / 비고객사(교육비+출장비) + 원거리시 직급별 일당·숙박
 * - 모든 금액은 원 단위 반올림, 표시는 천단위 콤마 + 한글 금액 힌트
 */

const STORAGE_KEY = 'educationBudgetPlannerState.v7';
let chartInstances = {};

/* ===================== 전역 상태 ===================== */
const state = {
  settings: {},
  plans: {},
  nextPlanId: 1,
  simulation: {},
  onboardingShown: false
};

/* ===================== 부팅 ===================== */
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderSettings();
  renderPlanEntry();
  renderSummary();
  renderDashboard();
  renderReport();
  updateProgressTracker();
  if (!state.onboardingShown) setTimeout(showOnboarding, 350);
});

/* ===================== 온보딩/탭 ===================== */
function showOnboarding(){ document.getElementById('onboardingOverlay')?.classList.add('active'); }
function startOnboarding(){ state.onboardingShown = true; persistState(); document.getElementById('onboardingOverlay')?.classList.remove('active'); }
function skipOnboarding(){ state.onboardingShown = true; persistState(); document.getElementById('onboardingOverlay')?.classList.remove('active'); }

function switchTab(event, tabName){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  if(event?.currentTarget) event.currentTarget.classList.add('active');
  const targetContent = document.getElementById(tabName);
  if(targetContent) targetContent.classList.add('active');
  
  if (tabName==='dashboard') renderDashboard();
  if (tabName==='report') renderReport();
  if (tabName==='settings') renderSettings();
  if (tabName==='plan') renderPlanEntry();
  if (tabName==='summary') renderSummary();
  
  updateProgressTracker();
}
/* ===================== 저장/로드 ===================== */
function loadState(){
  const defaults = {
    settings: getDefaultSettings(),
    plans: getEmptyPlans(),
    nextPlanId: 1,
    simulation: getDefaultSimulation(),
    onboardingShown: false
  };
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw){ Object.assign(state, defaults); return; }
    const parsed = JSON.parse(raw);

    state.settings = mergeSettings(defaults.settings, parsed.settings||{});
    state.plans    = mergePlans(parsed.plans||{});
    state.nextPlanId = parsed.nextPlanId || 1;
    state.simulation = Object.assign(getDefaultSimulation(), parsed.simulation||{});
    state.onboardingShown = !!parsed.onboardingShown;
  }catch(e){
    console.warn('상태 복구 실패, 기본값 사용:', e);
    Object.assign(state, defaults);
  }
}
function persistState(msg){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); if (msg) console.info(msg); }
  catch(e){ console.warn('저장 실패:', e); }
}

/* ===================== 기본값/머지 ===================== */
function getDefaultSettings(){
  return ensureShape({
    year: 2026,
    currency: 'KRW',

    // 직무 트랙 관련
    legalBaseBudget: 180000000,
    legalMandatoryShare: null,
    jobDefaultOtherCost: 5000000,
    jobSessionsPerHead: { customer: 1, nonCustomer: 1 }, // 팀 자동배분용 1인당 차수
    avgJobSessionsPerPerson: 1, // 표기용

    leadershipLevels: [
      { id: gen('lead'), level:'핵심 리더', unitCost:680000 },
      { id: gen('lead'), level:'책임 리더', unitCost:540000 },
      { id: gen('lead'), level:'중간관리자', unitCost:620000 }
    ],
    jobSegments: [
      { id: gen('jobseg'), name:'OEM 프로젝트 운영',    ratio:35, unitCost:420000, category:'고객사' },
      { id: gen('jobseg'), name:'협력사 전문기술 위탁', ratio:25, unitCost:380000, category:'고객사 외' },
      { id: gen('jobseg'), name:'사내 아카데미',        ratio:20, unitCost:220000, category:'고객사 외' },
      { id: gen('jobseg'), name:'품질 강화 과정',       ratio:20, unitCost:320000, category:'고객사 외' }
    ],

    /* === 출장비 정책 ===
       matrix[origin][dest]=금액(왕복 교통비)
       bandMatrix[origin][dest]='근거리'|'원거리'
       perDiemRules:
         - 근거리/원거리 밴드별 일당·숙박 규칙
         - NEW: perRankByBand['원거리'][rank] = 직급별 일당
    */
    travelPolicy: {
      origins: [ { id: gen('org'), name:'본사' }, { id: gen('org'), name:'울산공장' } ],
      destinations: [
        { id: gen('dst'), name:'서울/본사', band:'원거리' },
        { id: gen('dst'), name:'울산',     band:'근거리' }
      ],
      matrix: {},
      bandMatrix: {},
      perDiemRules: {
        applyPerDiemByBand: { '근거리': true, '원거리': true },
        applyLodgingByBand: { '근거리': true, '원거리': true },
        perDiemByBand:      { '근거리': 30000, '원거리': 0 },  // 원거리 기본은 0 (직급별 일당 사용)
        perRankByBand: {
          '원거리': { '사원': 20000, '대리': 25000, '과·차 이상': 300000 } // 요청값. 필요시 화면에서 수정 가능.
        },
        lodgingPerNight: 60000,
        defaultNights: 1
      }
    },

    hierarchyLevels: [
      { id: gen('hier'), level:'사원',      participation:90, unitCost:210000 },
      { id: gen('hier'), level:'대리',      participation:85, unitCost:230000 },
      { id: gen('hier'), level:'과장',      participation:80, unitCost:260000 },
      { id: gen('hier'), level:'차장 이상',  participation:70, unitCost:290000 }
    ],
    legalTypes: [
      { id: gen('legal'), type:'산업안전',              ratio:40, unitCost:85000 },
      { id: gen('legal'), type:'개인정보/정보보호',     ratio:25, unitCost:65000 },
      { id: gen('legal'), type:'직장 내 4대 폭력 예방',  ratio:20, unitCost:60000 },
      { id: gen('legal'), type:'법정 기본 과정',        ratio:15, unitCost:55000 }
    ],
    miscCategories: [
      { id: gen('misc'), name:'자격증 취득' },
      { id: gen('misc'), name:'평가/진단 과정' }
    ],

    /* Teams (배분 대상) */
    teams: [
      { id: gen('team'), name:'생산1팀', headcount:60, origin:'본사', customerSharePct:70, customerDestination:'울산',  nonCustomerDestination:'서울/본사', jobBudgetManual:0, rankLevel:'사원' },
      { id: gen('team'), name:'품질보증팀', headcount:30, origin:'본사', customerSharePct:50, customerDestination:'울산',  nonCustomerDestination:'서울/본사', jobBudgetManual:0, rankLevel:'대리' },
      { id: gen('team'), name:'HR팀',   headcount:10, origin:'본사', customerSharePct:20, customerDestination:'울산',  nonCustomerDestination:'서울/본사', jobBudgetManual:0, rankLevel:'과·차 이상' }
    ]
  });
}
function initTravelMatrixIfNeeded(policy){
  if (!policy.matrix) policy.matrix = {};
  if (!policy.bandMatrix) policy.bandMatrix = {};
  policy.origins.forEach(o=>{
    if (!policy.matrix[o.name]) policy.matrix[o.name]={};
    if (!policy.bandMatrix[o.name]) policy.bandMatrix[o.name]={};
  });
}
function getEmptyPlans(){ return { leadership:[], job:[], hierarchy:[], legal:[], misc:[] }; }
function getDefaultSimulation(){
  return {
    overallHeadcountDelta: 0,
    overallUnitCostDelta: 0,
    byTrack: {
      leadership:{ headcountDelta:0, unitCostDelta:0 },
      job:{ headcountDelta:0, unitCostDelta:0 },
      hierarchy:{ headcountDelta:0, unitCostDelta:0 },
      legal:{ headcountDelta:0, unitCostDelta:0 },
      misc:{ headcountDelta:0, unitCostDelta:0 }
    }
  };
}
function mergeSettings(defs, ovr){
  const base = JSON.parse(JSON.stringify(defs));
  const out = { ...base, ...ovr };

  ['leadershipLevels','jobSegments','hierarchyLevels','legalTypes','miscCategories','teams'].forEach(k=>{
    out[k] = (ovr[k]||base[k]).map(x=>({ id:x.id||gen(k.slice(0,4)), ...x }));
  });
  out.jobSegments = out.jobSegments.map(s=>({ ...s, category: s.category || '고객사 외' }));

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

  if (ovr.travelPolicy?.matrix){
    Object.keys(ovr.travelPolicy.matrix).forEach(o=>{
      out.travelPolicy.matrix[o] = { ...(out.travelPolicy.matrix[o]||{}), ...(ovr.travelPolicy.matrix[o]||{}) };
    });
  }
  if (ovr.travelPolicy?.bandMatrix){
    Object.keys(ovr.travelPolicy.bandMatrix).forEach(o=>{
      out.travelPolicy.bandMatrix[o] = { ...(out.travelPolicy.bandMatrix[o]||{}), ...(ovr.travelPolicy.bandMatrix[o]||{}) };
    });
  }

  // 차수 설정 병합
  const js = ovr.jobSessionsPerHead || base.jobSessionsPerHead || {customer:1, nonCustomer:1};
  out.jobSessionsPerHead = { customer: +js.customer||0, nonCustomer: +js.nonCustomer||0 };

  return out;
}
function mergePlans(saved){
  const d = getEmptyPlans(); const out = { ...d };
  Object.keys(out).forEach(k => { out[k] = (saved[k]||[]).map(x => JSON.parse(JSON.stringify(x))); });
  out.job = out.job.map(p => ({
    ...p,
    weightings:(p.weightings||[]).map(w=>({ id:w.id||gen('planW'), ...w, category:w.category||'고객사 외' })),
    locations:(p.locations||[]).map(l=>({ id:l.id||gen('planL'), ...l }))
  }));
  return out;
}

/* ===================== 유틸 ===================== */
const gen = p => `${p}_${Math.random().toString(36).slice(2,9)}`;
function ensureShape(s){ return JSON.parse(JSON.stringify(s)); }
const coalesce = (v,f)=> (v===undefined||v===null)?f:v;
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function parseNumberInput(v){
  if (v===null||v===undefined) return null;
  if (typeof v==='number') return Number.isFinite(v)?v:null;
  const cleaned = String(v).replace(/,/g,'').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num)?num:null;
}
function formatNumberInput(v){
  if (v===null||v===undefined||v==='') return '';
  const n = (typeof v==='number') ? v : parseNumberInput(v);
  if (n===null||!Number.isFinite(n)) return '';
  return n.toLocaleString('ko-KR');
}
function sum(arr){ return arr.reduce((a,b)=>a+(Number(b)||0),0); }
function toKoreanCurrencyShort(n){
  n = Math.floor(Number(n)||0);
  if (n<=0) return '0원';
  const eok = Math.floor(n/1e8);
  const remAfterEok = n % 1e8;
  const man = Math.floor(remAfterEok/1e4);
  const won = remAfterEok % 1e4;
  let parts = [];
  if (eok>0) parts.push(`${eok}억`);
  if (man>0) parts.push(`${man}만`);
  if (won>0) parts.push(`${won}`);
  let s = parts.join(' ');
  s += '원';
  return s;
}
function hangulHintHtml(value){
  const n = parseNumberInput(value)||0;
  return `<div class="hint" style="font-size:.8em;color:#9cb5e9;margin-top:4px;">${toKoreanCurrencyShort(n)}</div>`;
}
function roundWon(n){ const v = Number(n)||0; return Math.round(v); }
function labelOf(key){
  return ({
    leadership:'리더십',
    job:'직무',
    hierarchy:'직급공통',
    legal:'법정',
    misc:'기타'
  })[key] || key;
}

/* ===================== 진행도 ===================== */
function updateProgressTracker(){
  const steps = [
    { id:'settings',  title:'SETTINGS',  desc:'기본/팀/출장 정책', check:()=> state.settings?.year },
    { id:'plan',      title:'PLAN ENTRY',desc:'계획 입력',   check:()=> Object.values(state.plans).some(a=>a.length>0) },
    { id:'summary',   title:'SUMMARY',   desc:'요약/배분표', check:()=> true },
    { id:'dashboard', title:'DASHBOARD', desc:'시각화',      check:()=> true },
    { id:'report',    title:'REPORT',    desc:'보고서',      check:()=> true }
  ];
  const container = document.getElementById('progressSteps'); if (!container) return;
  container.innerHTML = steps.map((st,i)=>{
    const active = document.querySelector('.tab.active')?.dataset.target;
    const completed = !!st.check();
    const inProgress = active===st.id;
    const klass = completed? 'completed' : (inProgress? 'in-progress':'');
    const icon = completed ? '✓' : (i+1);
    return `
      <div class="progress-step ${klass}">
        <div class="progress-step-header">
          <div class="progress-step-icon">${icon}</div>
          <div class="progress-step-title">${st.title}</div>
        </div>
        <div class="progress-step-desc">${st.desc}</div>
      </div>`;
  }).join('');
}

/* ===================== SETTINGS ===================== */
function validateJobSegmentRatios(){ return Math.abs(sum((state.settings.jobSegments||[]).map(s=>+s.ratio||0))-100)<0.1; }
function validateLegalTypeRatios(){ return Math.abs(sum((state.settings.legalTypes||[]).map(t=>+t.ratio||0))-100)<0.1; }
function showValidationErrors(errors){
  const el = document.getElementById('validationSummary'); if (!el) return;
  if (!errors.length){ el.classList.remove('active'); return; }
  el.classList.add('active'); const ul = el.querySelector('ul'); if (ul) ul.innerHTML = errors.map(e=>`<li>${e}</li>`).join('');
}
function updateSetting(key, value){
  if (['legalBaseBudget','jobDefaultOtherCost'].includes(key)){
    state.settings[key] = parseNumberInput(value) ?? 0;
  } else if (['legalMandatoryShare'].includes(key)){
    const v = parseNumberInput(value); state.settings[key] = (v===null? null : Math.max(0, Math.min(100, v)));
  } else if (key==='year'){
    state.settings.year = Math.max(2024, Math.min(2100, Number(value)||new Date().getFullYear()));
  } else if (key==='currency'){
    state.settings.currency = String(value||'KRW').slice(0,10);
  } else if (key==='jobSessionsCustomer'){
    state.settings.jobSessionsPerHead.customer = Math.max(0, parseNumberInput(value) ?? 0);
  } else if (key==='jobSessionsNonCustomer'){
    state.settings.jobSessionsPerHead.nonCustomer = Math.max(0, parseNumberInput(value) ?? 0);
  } else if (key==='avgJobSessionsPerPerson'){
    state.settings.avgJobSessionsPerPerson = Math.max(0, parseNumberInput(value) ?? 0);
  }
  persistState(); renderSettings(); renderSummary(); renderDashboard(); renderReport(); updateProgressTracker();
}

/* 리더십/직무/직급/법정 CRUD */
function updateLeadershipLevel(id, field, value){ const it=state.settings.leadershipLevels.find(x=>x.id===id); if(!it) return; it[field]= (field==='unitCost'? (parseNumberInput(value)||0):value); persistState(); renderSettings(); renderSummary(); renderDashboard(); renderReport(); }
function removeLeadershipLevel(id){ state.settings.leadershipLevels = state.settings.leadershipLevels.filter(x=>x.id!==id); persistState(); renderSettings(); renderSummary(); renderDashboard(); renderReport(); }
function addLeadershipLevel(){ state.settings.leadershipLevels.push({ id:gen('lead'), level:'새 계층', unitCost:0 }); persistState(); renderSettings(); }

function updateJobSegment(id, field, value){ const seg=state.settings.jobSegments.find(s=>s.id===id); if(!seg) return; seg[field]= (['ratio','unitCost'].includes(field)? (parseNumberInput(value)||0):value); persistState(); renderSettings(); renderSummary(); renderDashboard(); }
function removeJobSegment(id){ state.settings.jobSegments = state.settings.jobSegments.filter(s=>s.id!==id); persistState(); renderSettings(); renderSummary(); renderDashboard(); }
function addJobSegment(){ state.settings.jobSegments.push({ id:gen('jobseg'), name:'새 유형', ratio:0, unitCost:0, category:'고객사 외' }); persistState(); renderSettings(); }

function updateHierarchyLevel(id, field, value){ const it=state.settings.hierarchyLevels.find(t=>t.id===id); if(!it) return; it[field]= (['participation','unitCost'].includes(field)? (parseNumberInput(value)||0):value); persistState(); renderSettings(); renderSummary(); }
function removeHierarchyLevel(id){ state.settings.hierarchyLevels = state.settings.hierarchyLevels.filter(t=>t.id!==id); persistState(); renderSettings(); }
function addHierarchyLevel(){ state.settings.hierarchyLevels.push({ id:gen('hier'), level:'새 직급', participation:0, unitCost:0 }); persistState(); renderSettings(); }

function updateLegalType(id, field, value){ const it=state.settings.legalTypes.find(t=>t.id===id); if(!it) return; it[field]= (['ratio','unitCost'].includes(field)? (parseNumberInput(value)||0):value); persistState(); renderSettings(); renderSummary(); }
function removeLegalType(id){ state.settings.legalTypes = state.settings.legalTypes.filter(t=>t.id!==id); persistState(); renderSettings(); }
function addLegalType(){ state.settings.legalTypes.push({ id:gen('legal'), type:'새 항목', ratio:0, unitCost:0 }); persistState(); renderSettings(); }

/* ===================== SETTINGS 렌더링 ===================== */
function renderSettings(){
  const el = document.getElementById('settingsContent'); 
  if (!el) return;
  
  const S = state.settings;
  const js = S.jobSessionsPerHead || {customer:1, nonCustomer:1};

  let html = `
    <div class="section-card">
      <div class="section-header">
        <div class="description">
          <h2>① 기본 설정</h2>
          <p>연도, 통화, 법정의무 예산 등 전체 시스템의 기준값을 설정합니다.</p>
        </div>
      </div>
      <div class="field-grid">
        <div class="field">
          <label>연도</label>
          <input type="number" value="${S.year||2026}" onchange="updateSetting('year', this.value)">
        </div>
        <div class="field">
          <label>통화</label>
          <input type="text" value="${escapeHtml(S.currency||'KRW')}" onchange="updateSetting('currency', this.value)">
        </div>
        <div class="field">
          <label>법정의무 기본예산(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(S.legalBaseBudget||0)}" onchange="updateSetting('legalBaseBudget', this.value)">
          ${hangulHintHtml(S.legalBaseBudget||0)}
        </div>
        <div class="field">
          <label>직무 기타비용 기본값(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(S.jobDefaultOtherCost||0)}" onchange="updateSetting('jobDefaultOtherCost', this.value)">
          ${hangulHintHtml(S.jobDefaultOtherCost||0)}
        </div>
        <div class="field">
          <label>팀배분: 고객사 차수(1인당)</label>
          <input type="number" min="0" step="0.1" value="${js.customer}" onchange="updateSetting('jobSessionsCustomer', this.value)">
        </div>
        <div class="field">
          <label>팀배분: 비고객사 차수(1인당)</label>
          <input type="number" min="0" step="0.1" value="${js.nonCustomer}" onchange="updateSetting('jobSessionsNonCustomer', this.value)">
        </div>
      </div>
    </div>

    ${renderLeadershipSection(S)}
    ${renderJobSegmentSection(S)}
    ${renderHierarchySection(S)}
    ${renderLegalSection(S)}
    ${renderTravelPolicySection(S)}
    ${renderTeamSettingsSection(S)}
  `;

  el.innerHTML = html;
}

function renderLeadershipSection(S){
  const rows = (S.leadershipLevels||[]).map(lv=>`
    <tr>
      <td><input type="text" value="${escapeHtml(lv.level||'')}" onchange="updateLeadershipLevel('${lv.id}','level',this.value)"></td>
      <td>
        <input type="text" inputmode="numeric" value="${formatNumberInput(lv.unitCost||0)}" onchange="updateLeadershipLevel('${lv.id}','unitCost',this.value)">
        ${hangulHintHtml(lv.unitCost||0)}
      </td>
      <td><button class="button button-tertiary" onclick="removeLeadershipLevel('${lv.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>② 리더십 레벨</h2>
        <p>핵심리더, 책임리더 등 계층별 단가를 설정합니다.</p>
      </div>
      <button class="button button-secondary" onclick="addLeadershipLevel()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>계층</th><th>단가(원)</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderJobSegmentSection(S){
  const rows = (S.jobSegments||[]).map(seg=>`
    <tr>
      <td><input type="text" value="${escapeHtml(seg.name||'')}" onchange="updateJobSegment('${seg.id}','name',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(seg.ratio||0)}" onchange="updateJobSegment('${seg.id}','ratio',this.value)"></td>
      <td>
        <input type="text" inputmode="numeric" value="${formatNumberInput(seg.unitCost||0)}" onchange="updateJobSegment('${seg.id}','unitCost',this.value)">
        ${hangulHintHtml(seg.unitCost||0)}
      </td>
      <td>
        <select onchange="updateJobSegment('${seg.id}','category',this.value)">
          <option value="고객사" ${seg.category==='고객사'?'selected':''}>고객사</option>
          <option value="고객사 외" ${seg.category!=='고객사'?'selected':''}>고객사 외</option>
        </select>
      </td>
      <td><button class="button button-tertiary" onclick="removeJobSegment('${seg.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>③ 직무 교육 세그먼트</h2>
        <p>OEM 프로젝트, 협력사 위탁 등 비율·단가·카테고리를 설정합니다.</p>
      </div>
      <button class="button button-secondary" onclick="addJobSegment()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>유형명</th><th>비율(%)</th><th>단가(원)</th><th>카테고리</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderHierarchySection(S){
  const rows = (S.hierarchyLevels||[]).map(lv=>`
    <tr>
      <td><input type="text" value="${escapeHtml(lv.level||'')}" onchange="updateHierarchyLevel('${lv.id}','level',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.participation||0)}" onchange="updateHierarchyLevel('${lv.id}','participation',this.value)"></td>
      <td>
        <input type="text" inputmode="numeric" value="${formatNumberInput(lv.unitCost||0)}" onchange="updateHierarchyLevel('${lv.id}','unitCost',this.value)">
        ${hangulHintHtml(lv.unitCost||0)}
      </td>
      <td><button class="button button-tertiary" onclick="removeHierarchyLevel('${lv.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>④ 직급 공통 교육</h2>
        <p>사원·대리·과장·차장 이상 직급별 참여율과 단가를 설정합니다.</p>
      </div>
      <button class="button button-secondary" onclick="addHierarchyLevel()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>직급</th><th>참여율(%)</th><th>단가(원)</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderLegalSection(S){
  const rows = (S.legalTypes||[]).map(t=>`
    <tr>
      <td><input type="text" value="${escapeHtml(t.type||'')}" onchange="updateLegalType('${t.id}','type',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(t.ratio||0)}" onchange="updateLegalType('${t.id}','ratio',this.value)"></td>
      <td>
        <input type="text" inputmode="numeric" value="${formatNumberInput(t.unitCost||0)}" onchange="updateLegalType('${t.id}','unitCost',this.value)">
        ${hangulHintHtml(t.unitCost||0)}
      </td>
      <td><button class="button button-tertiary" onclick="removeLegalType('${t.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>⑤ 법정의무 교육</h2>
        <p>산업안전, 개인정보보호 등 법정교육 항목별 비율과 단가를 설정합니다.</p>
      </div>
      <button class="button button-secondary" onclick="addLegalType()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>항목</th><th>비율(%)</th><th>단가(원)</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

/* === Travel Policy CRUD/유틸 === */
function addOrigin(){
  const name = `출발지${state.settings.travelPolicy.origins.length+1}`;
  state.settings.travelPolicy.origins.push({ id:gen('org'), name });
  initTravelMatrixIfNeeded(state.settings.travelPolicy);
  persistState(); renderSettings(); renderSummary();
}
function removeOrigin(id){
  const tp = state.settings.travelPolicy;
  const o = tp.origins.find(x=>x.id===id); if(!o) return;
  delete tp.matrix[o.name]; delete tp.bandMatrix[o.name];
  tp.origins = tp.origins.filter(x=>x.id!==id);
  const fallback = firstOriginName();
  state.settings.teams = state.settings.teams.map(t=> ({ ...t, origin: tp.origins.some(y=>y.name===t.origin)? t.origin : fallback }));
  persistState(); renderSettings(); renderSummary();
}
function updateOriginName(id, value){
  const tp = state.settings.travelPolicy;
  const origin = tp.origins.find(x=>x.id===id); if(!origin) return;
  const prevName = origin.name;
  const nextName = String(value||'').trim() || prevName;
  if (prevName===nextName) return;
  origin.name = nextName;
  tp.matrix[nextName] = { ...(tp.matrix[prevName]||{}) }; delete tp.matrix[prevName];
  tp.bandMatrix[nextName] = { ...(tp.bandMatrix[prevName]||{}) }; delete tp.bandMatrix[prevName];
  state.settings.teams.forEach(t=>{ if (t.origin===prevName) t.origin=nextName; });
  persistState(); renderSettings(); renderSummary();
}

function addDestination(){
  const name = `목적지${state.settings.travelPolicy.destinations.length + 1}`;
  state.settings.travelPolicy.destinations.push({ id: gen('dst'), name, band: '근거리' });
  const tp = state.settings.travelPolicy; initTravelMatrixIfNeeded(tp);
  Object.keys(tp.matrix).forEach(o=>{
    if (!tp.matrix[o]) tp.matrix[o] = {};
    if (!tp.bandMatrix[o]) tp.bandMatrix[o] = {};
    if (tp.matrix[o][name] === undefined) tp.matrix[o][name] = 20000;
    if (tp.bandMatrix[o][name] === undefined) tp.bandMatrix[o][name] = '근거리';
  });
  persistState(); renderSettings(); renderSummary();
}
function removeDestination(id){
  const tp = state.settings.travelPolicy;
  const d = tp.destinations.find(x=>x.id===id); if(!d) return;
  const name = d.name;
  tp.destinations = tp.destinations.filter(x=>x.id!==id);
  Object.keys(tp.matrix).forEach(o=>{
    delete tp.matrix[o][name];
    if (tp.bandMatrix[o]) delete tp.bandMatrix[o][name];
  });
  const fallback = firstDestinationName();
  state.settings.teams = state.settings.teams.map(t=> ({
    ...t,
    customerDestination: (t.customerDestination===name? fallback : t.customerDestination),
    nonCustomerDestination: (t.nonCustomerDestination===name? fallback : t.nonCustomerDestination)
  }));
  persistState(); renderSettings(); renderSummary();
}
function updateDestinationField(id, field, value){
  const tp = state.settings.travelPolicy;
  const d = tp.destinations.find(x=>x.id===id); if(!d) return;
  const prevName = d.name;

  if (field==='name'){
    const next = String(value||'').trim() || prevName;
    if (next===prevName) return;
    d.name = next;
    Object.keys(tp.matrix).forEach(o=>{
      const row = tp.matrix[o]; row[next] = row[prevName]; delete row[prevName];
      const brow = tp.bandMatrix[o]; if (brow){ brow[next] = brow[prevName]; delete brow[prevName]; }
    });
    state.settings.teams.forEach(t=>{
      if (t.customerDestination===prevName) t.customerDestination=next;
      if (t.nonCustomerDestination===prevName) t.nonCustomerDestination=next;
    });
  } else if (field==='band'){
    d.band = value==='원거리' ? '원거리' : '근거리';
  }
  persistState(); renderSettings(); renderSummary();
}

function updateMatrixAmount(originName, destName, value){
  const tp = state.settings.travelPolicy;
  const amt = parseNumberInput(value) ?? 0;
  if (!tp.matrix[originName]) tp.matrix[originName] = {};
  tp.matrix[originName][destName] = amt;
  persistState(); renderSettings(); renderSummary();
}
function updateMatrixBand(originName, destName, value){
  const tp = state.settings.travelPolicy;
  if (!tp.bandMatrix[originName]) tp.bandMatrix[originName] = {};
  tp.bandMatrix[originName][destName] = (value==='원거리' ? '원거리' : '근거리');
  persistState(); renderSettings(); renderSummary();
}

/* Per-Diem 규칙 UI/업데이트 */
function updatePerDiemRule(field, value){
  const r = state.settings.travelPolicy.perDiemRules;
  if (field==='lodgingPerNight' || field==='defaultNights'){
    r[field] = Math.max(0, parseNumberInput(value) ?? 0);
  } else if (field==='perDiemNear'){
    r.perDiemByBand['근거리'] = Math.max(0, parseNumberInput(value) ?? 0);
  } else if (field==='perDiemFar'){
    r.perDiemByBand['원거리'] = Math.max(0, parseNumberInput(value) ?? 0);
  } else if (field==='applyPerDiemNear'){
    r.applyPerDiemByBand['근거리'] = !!value.checked;
  } else if (field==='applyPerDiemFar'){
    r.applyPerDiemByBand['원거리'] = !!value.checked;
  } else if (field==='applyLodgingNear'){
    r.applyLodgingByBand['근거리'] = !!value.checked;
  } else if (field==='applyLodgingFar'){
    r.applyLodgingByBand['원거리'] = !!value.checked;
  } else if (field.startsWith('rankFar_')){
    const key = field.replace('rankFar_',''); // '사원'|'대리'|'과·차 이상'
    r.perRankByBand['원거리'][key] = Math.max(0, parseNumberInput(value) ?? 0);
  }
  persistState(); renderSettings(); renderSummary();
}

/* 계산용 헬퍼 */
function firstOriginName(){ return state.settings.travelPolicy.origins[0]?.name || '본사'; }
function firstDestinationName(){ return state.settings.travelPolicy.destinations[0]?.name || '서울/본사'; }
function getBandOfDestination(tp, destName){ const d = tp.destinations.find(x=>x.name===destName); return d?.band || '근거리'; }
function getBandForPair(tp, originName, destName){
  const row = (tp.bandMatrix||{})[originName] || {};
  return row[destName] || getBandOfDestination(tp, destName) || '근거리';
}

/* 팀 주요 직급 셀렉터 옵션 */
const TEAM_RANK_OPTIONS = ['사원','대리','과·차 이상'];

/* === Travel Policy 렌더 (교통비.xlsx 업로드 포함) === */
function renderTravelPolicySection(settings){
  const tp = settings.travelPolicy; initTravelMatrixIfNeeded(tp);
  const originNames = tp.origins.map(o=>o.name);
  const dests = tp.destinations;
  const bandBadge = b=> b==='근거리' ? `<span class="pill">근거리</span>` : `<span class="pill">원거리</span>`;
  const r = tp.perDiemRules;

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>⑥ 출장비 정책 (출발지 × 목적지)</h2>
        <p>엑셀(교통비.xlsx) 업로드로 요금과 근거리여부를 자동 반영할 수 있습니다.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="button button-primary" onclick="triggerTravelXlsx()">교통비.xlsx 업로드</button>
        <input id="travelXlsxInput" type="file" accept=".xlsx" style="display:none" onchange="handleTravelXlsx(event)">
      </div>
    </div>

    <div class="sub-table">
      <div class="flex-between" style="margin-bottom:8px;">
        <h4>1) 출발지</h4>
        <button class="button button-secondary" onclick="addOrigin()">+ 출발지 추가</button>
      </div>
      <div class="summary-table"><table>
        <thead><tr><th>출발지명</th><th>삭제</th></tr></thead>
        <tbody>${tp.origins.map(o=>`
          <tr>
            <td><input type="text" value="${escapeHtml(o.name)}" onchange="updateOriginName('${o.id}', this.value)"></td>
            <td><button class="button button-tertiary" onclick="removeOrigin('${o.id}')">삭제</button></td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>

    <div class="sub-table" style="margin-top:16px;">
      <div class="flex-between" style="margin-bottom:8px;">
        <h4>2) 목적지 (기본 권역 참고)</h4>
        <button class="button button-secondary" onclick="addDestination()">+ 목적지 추가</button>
      </div>
      <div class="summary-table"><table>
        <thead><tr><th>목적지명</th><th>기본 거리권역</th><th>표시</th><th>삭제</th></tr></thead>
        <tbody>${dests.map(d=>`
          <tr>
            <td><input type="text" value="${escapeHtml(d.name)}" onchange="updateDestinationField('${d.id}','name',this.value)"></td>
            <td>
              <select onchange="updateDestinationField('${d.id}','band',this.value)">
                <option value="근거리" ${d.band==='근거리'?'selected':''}>근거리</option>
                <option value="원거리" ${d.band==='원거리'?'selected':''}>원거리</option>
              </select>
            </td>
            <td>${bandBadge(d.band)}</td>
            <td><button class="button button-tertiary" onclick="removeDestination('${d.id}')">삭제</button></td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>

    <div class="sub-table" style="margin-top:16px;">
      <h4>3) 출발지 × 목적지 요금표/권역 (원)</h4>
      <div class="summary-table travel-matrix">
        <table>
          <thead>
            <tr>
              <th>출발지 \\ 목적지</th>
              ${dests.map(d=>`<th>${escapeHtml(d.name)}<div class="mini">${bandBadge(d.band)}</div></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${originNames.map(on=>{
              const rowAmt = tp.matrix[on]||{};
              const rowBand = (tp.bandMatrix||{})[on]||{};
              return `<tr>
                <td><strong>${escapeHtml(on)}</strong></td>
                ${dests.map(d=>{
                  const val  = rowAmt[d.name] ?? 0;
                  const band = rowBand[d.name] || d.band || '근거리';
                  return `<td>
                    <div style="display:grid; gap:6px;">
                      <div>
                        <input type="text" inputmode="numeric"
                               value="${formatNumberInput(val)}"
                               onchange="updateMatrixAmount('${escapeHtml(on)}','${escapeHtml(d.name)}', this.value)">
                        ${hangulHintHtml(val)}
                      </div>
                      <div>
                        <select onchange="updateMatrixBand('${escapeHtml(on)}','${escapeHtml(d.name)}', this.value)">
                          <option value="근거리" ${band==='근거리'?'selected':''}>근거리</option>
                          <option value="원거리" ${band==='원거리'?'selected':''}>원거리</option>
                        </select>
                      </div>
                    </div>
                  </td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="sub-table" style="margin-top:16px;">
      <h4>4) 거리권역별 Per-Diem/숙박 규칙 + (원거리) 직급별 일당</h4>
      <div class="field-grid">
        <div class="field">
          <label>근거리: Per-Diem(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(r.perDiemByBand['근거리'])}" onchange="updatePerDiemRule('perDiemNear', this.value)">
          ${hangulHintHtml(r.perDiemByBand['근거리'])}
          <label class="inline"><input type="checkbox" ${r.applyPerDiemByBand['근거리']?'checked':''} onchange="updatePerDiemRule('applyPerDiemNear', this)"> 적용</label>
          <label class="inline" style="margin-left:8px;"><input type="checkbox" ${r.applyLodgingByBand['근거리']?'checked':''} onchange="updatePerDiemRule('applyLodgingNear', this)"> 숙박 적용</label>
        </div>

        <div class="field">
          <label>원거리: 기본 Per-Diem(원) <span class="note">(직급별 일당이 있으면 이 값 대신 직급 일당을 사용)</span></label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(r.perDiemByBand['원거리'])}" onchange="updatePerDiemRule('perDiemFar', this.value)">
          ${hangulHintHtml(r.perDiemByBand['원거리'])}
          <label class="inline"><input type="checkbox" ${r.applyPerDiemByBand['원거리']?'checked':''} onchange="updatePerDiemRule('applyPerDiemFar', this)"> 적용</label>
          <label class="inline" style="margin-left:8px;"><input type="checkbox" ${r.applyLodgingByBand['원거리']?'checked':''} onchange="updatePerDiemRule('applyLodgingFar', this)"> 숙박 적용</label>
        </div>

        <div class="field">
          <label>숙박비(1박, 원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(r.lodgingPerNight)}" onchange="updatePerDiemRule('lodgingPerNight', this.value)">
          ${hangulHintHtml(r.lodgingPerNight)}
        </div>
        <div class="field">
          <label>기본 숙박 박수</label>
          <input type="number" min="0" value="${r.defaultNights}" onchange="updatePerDiemRule('defaultNights', this.value)">
        </div>

        <!-- 원거리 직급별 일당 -->
        <div class="field">
          <label>원거리·사원 일당(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(r.perRankByBand?.['원거리']?.['사원']||0)}" onchange="updatePerDiemRule('rankFar_사원', this.value)">
          ${hangulHintHtml(r.perRankByBand?.['원거리']?.['사원']||0)}
        </div>
        <div class="field">
          <label>원거리·대리 일당(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(r.perRankByBand?.['원거리']?.['대리']||0)}" onchange="updatePerDiemRule('rankFar_대리', this.value)">
          ${hangulHintHtml(r.perRankByBand?.['원거리']?.['대리']||0)}
        </div>
        <div class="field">
          <label>원거리·과·차 이상 일당(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(r.perRankByBand?.['원거리']?.['과·차 이상']||0)}" onchange="updatePerDiemRule('rankFar_과·차 이상', this.value)">
          ${hangulHintHtml(r.perRankByBand?.['원거리']?.['과·차 이상']||0)}
        </div>
      </div>
    </div>
  </div>`;
}

function triggerTravelXlsx(){ document.getElementById('travelXlsxInput')?.click(); }

/* 교통비.xlsx 핸들러
   - 시트명: '교통비'
   - 컬럼: 출발지, 출장지역, 자차교통비(왕복), 대중교통비(왕복), 근거리여부('O'면 근거리, 그 외 원거리)
   - 대중교통비가 숫자면 우선, 없으면 자차교통비 사용
*/
function handleTravelXlsx(evt){
  const file = evt.target.files?.[0]; if (!file) return;
  if (typeof XLSX==='undefined'){ alert('xlsx 라이브러리를 불러오지 못했습니다. index.html에 xlsx.full.min.js를 추가하세요.'); evt.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const ws = wb.Sheets['교통비'] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);

      const tp = state.settings.travelPolicy; initTravelMatrixIfNeeded(tp);

      rows.forEach(r=>{
        const origin = String(r['출발지']||'').trim();
        const dest   = String(r['출장지역']||'').trim();
        if (!origin || !dest) return;

        const car   = parseNumberInput(r['자차교통비(왕복)']) || 0;
        const publicT = parseNumberInput(r['대중교통비(왕복)']);
        const fare  = Number.isFinite(publicT) && publicT>0 ? publicT : car;

        const nearFlag = String(r['근거리여부']||'').trim();
        const band = (nearFlag==='O' || nearFlag==='o' || nearFlag==='Y') ? '근거리' : '원거리';

        // 출발지/목적지 목록에 없으면 추가
        if (!tp.origins.some(o=>o.name===origin)) tp.origins.push({ id:gen('org'), name:origin });
        if (!tp.destinations.some(d=>d.name===dest)) tp.destinations.push({ id:gen('dst'), name:dest, band });

        if (!tp.matrix[origin]) tp.matrix[origin]={};
        if (!tp.bandMatrix[origin]) tp.bandMatrix[origin]={};

        tp.matrix[origin][dest] = fare;
        tp.bandMatrix[origin][dest] = band;
      });

      // 누락된 행 초기화
      initTravelMatrixIfNeeded(tp);
      persistState('교통비.xlsx 적용 완료');
      renderSettings(); renderSummary();
    }catch(err){
      console.error(err);
      alert('교통비.xlsx 파싱 중 오류가 발생했습니다. (시트명: 교통비, 헤더 이름을 확인하세요)');
    } finally { evt.target.value=''; }
  };
  reader.readAsArrayBuffer(file);
}

/* ===================== Teams 섹션 ===================== */
function renderTeamSettingsSection(settings){
  const tp = settings.travelPolicy; const originOpts = tp.origins.map(o=>o.name); const destOpts = tp.destinations.map(d=>d.name);
  const options = (list, curr) => list.map(x=>`<option value="${escapeHtml(x)}" ${x===curr?'selected':''}>${escapeHtml(x)}</option>`).join('');
  const rankOpts = TEAM_RANK_OPTIONS;

  const rowsHtml = (settings.teams||[]).map(t=>{
    const jobBudget = +t.jobBudgetManual||0;
    return `
      <tr>
        <td><input type="text" value="${escapeHtml(t.name||'')}" onchange="updateTeam('${t.id}','name',this.value)"></td>
        <td><input type="number" min="0" value="${t.headcount||0}" onchange="updateTeam('${t.id}','headcount',this.value)"></td>
        <td><select onchange="updateTeam('${t.id}','origin',this.value)">${options(originOpts, t.origin||firstOriginName())}</select></td>
        <td><select onchange="updateTeam('${t.id}','rankLevel',this.value)">${options(rankOpts, t.rankLevel||'사원')}</select></td>
        <td><input type="number" min="0" max="100" step="1" value="${t.customerSharePct||0}" onchange="updateTeam('${t.id}','customerSharePct',this.value)"></td>
        <td><select onchange="updateTeam('${t.id}','customerDestination',this.value)">${options(destOpts, t.customerDestination||firstDestinationName())}</select></td>
        <td><select onchange="updateTeam('${t.id}','nonCustomerDestination',this.value)">${options(destOpts, t.nonCustomerDestination||firstDestinationName())}</select></td>
        <td>
          <input type="text" inputmode="numeric" value="${formatNumberInput(jobBudget)}"
                 onfocus="this.value=this.value.replace(/,/g,'')"
                 onblur="(function(el){
                    const v = parseNumberInput(el.value) || 0;
                    updateTeam('${t.id}','jobBudgetManual', v);
                    el.value = formatNumberInput(v);
                    const hint = el.parentElement.querySelector('.krw-hint');
                    if (hint) hint.textContent = toKoreanCurrencyShort(v);
                  })(this)">
          <div class="krw-hint" style="font-size:.8em;color:#9cb5e9;margin-top:4px;">${toKoreanCurrencyShort(jobBudget)}</div>
        </td>
        <td><button class="button button-tertiary" onclick="removeTeam('${t.id}')">삭제</button></td>
      </tr>`;
  }).join('');

  const js = settings.jobSessionsPerHead || {customer:1, nonCustomer:1};

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>⑦ Teams (배분 대상)</h2>
        <p>팀별 인원·출발지·<b>주요 직급</b>·고객사 비중과 목적지를 지정합니다. 고객사 차수 ${js.customer} / 비고객사 차수 ${js.nonCustomer} 기준으로 자동 배분합니다.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="button button-secondary" onclick="downloadTeamsTemplate()">템플릿 다운로드(CSV)</button>
        <button class="button button-secondary" onclick="exportTeamsToCSV()">현재 Teams 내보내기(CSV)</button>
        <button class="button button-primary" onclick="triggerTeamsUpload()">업로드(CSV/XLSX)</button>
        <input id="teamsFileInput" type="file" accept=".csv,.xlsx" style="display:none" onchange="handleTeamsFile(event)">
        <button class="button button-tertiary" onclick="addTeam()">+ 팀 추가</button>
      </div>
    </div>

    <div class="summary-table"><table>
      <thead><tr>
        <th>팀명</th><th>인원</th><th>출발지</th><th>주요 직급</th><th>고객사 비중(%)</th>
        <th>고객사 목적지</th><th>비고객사 목적지</th>
        <th>직무교육비(직접배부)</th><th>삭제</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  </div>`;
}
function updateTeam(id, field, value){
  const t = state.settings.teams.find(x=>x.id===id); if(!t) return;
  if (['headcount','customerSharePct','jobBudgetManual'].includes(field)) t[field] = Math.max(0, parseNumberInput(value) ?? 0);
  else t[field] = value;
  if (field==='customerSharePct') t[field] = Math.min(100, t[field]);
  persistState(); renderSettings(); renderSummary();
}
function addTeam(){ state.settings.teams.push({ id:gen('team'), name:'새 팀', headcount:0, origin: firstOriginName(), rankLevel:'사원', customerSharePct:50, customerDestination: firstDestinationName(), nonCustomerDestination: firstDestinationName(), jobBudgetManual:0 }); persistState(); renderSettings(); renderSummary(); }
function removeTeam(id){ state.settings.teams = state.settings.teams.filter(t=>t.id!==id); persistState(); renderSettings(); renderSummary(); }

/* Teams CSV/XLSX (주요 직급 포함) */
function downloadTeamsTemplate(){
  const headers = ['name','headcount','origin','rankLevel','customerSharePct','customerDestination','nonCustomerDestination','jobBudgetManual'];
  const sample = [
    ['생산1팀','60','본사','사원','70','울산','서울/본사','0'],
    ['품질보증팀','30','본사','대리','50','울산','서울/본사','0'],
    ['HR팀','10','본사','과·차 이상','20','울산','서울/본사','0']
  ];
  const csv = [headers.join(','), ...sample.map(r=>r.join(','))].join('\r\n');
  downloadText(csv, 'teams_template.csv', 'text/csv');
}
function exportTeamsToCSV(){
  const headers = ['name','headcount','origin','rankLevel','customerSharePct','customerDestination','nonCustomerDestination','jobBudgetManual'];
  const rows = (state.settings.teams||[]).map(t=>[
    t.name||'',
    String(t.headcount||0),
    t.origin||'',
    t.rankLevel||'사원',
    String(t.customerSharePct||0),
    t.customerDestination||'',
    t.nonCustomerDestination||'',
    String(t.jobBudgetManual||0)
  ]);
  const csv = [headers.join(','), ...rows.map(r=>r.map(escapeCsv).join(','))].join('\r\n');
  downloadText(csv, `teams_export_${state.settings.year||''}.csv`, 'text/csv');
}
function triggerTeamsUpload(){ document.getElementById('teamsFileInput')?.click(); }
function handleTeamsFile(evt){
  const file = evt.target.files?.[0]; if (!file) return;
  const name = (file.name||'').toLowerCase();

  if (name.endsWith('.xlsx')){
    if (typeof XLSX==='undefined'){ alert('XLSX 라이브러리를 불러오지 못했습니다. index.html에 xlsx.min.js를 추가하세요.'); evt.target.value=''; return; }
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        if (!rows.length){ alert('업로드한 XLSX에서 데이터를 찾지 못했습니다.'); evt.target.value=''; return; }
        applyTeamRows(rows); evt.target.value='';
      }catch(err){ console.error(err); alert('XLSX 파싱 중 오류가 발생했습니다.'); }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const text = await decodeArrayBufferSmart(reader.result);
      const lines = text.split(/\r?\n/).filter(x=>x.trim().length>0);
      if (!lines.length){ alert('빈 CSV 입니다.'); evt.target.value=''; return; }

      const headers = splitCsv(lines.shift()).map(x=>x.trim());
      const idx = (k)=> headers.indexOf(k);
      const need = ['name','headcount','origin','rankLevel','customerSharePct','customerDestination','nonCustomerDestination','jobBudgetManual'];
      const missing = need.filter(k=> idx(k)===-1);
      if (missing.length){
        alert('CSV 헤더가 올바르지 않습니다.\n누락: '+missing.join(', ')+'\n\n템플릿을 내려받아 동일한 헤더로 업로드 해주세요.');
        evt.target.value=''; return;
      }
      const rows = lines.map(line=>{
        const cols = splitCsv(line, headers.length);
        return {
          name: (cols[idx('name')]||'').trim(),
          headcount: cols[idx('headcount')],
          origin: (cols[idx('origin')]||'').trim(),
          rankLevel: (cols[idx('rankLevel')]||'사원').trim(),
          customerSharePct: cols[idx('customerSharePct')],
          customerDestination: (cols[idx('customerDestination')]||'').trim(),
          nonCustomerDestination: (cols[idx('nonCustomerDestination')]||'').trim(),
          jobBudgetManual: cols[idx('jobBudgetManual')]
        };
      });
      applyTeamRows(rows);
      evt.target.value='';
    }catch(err){
      console.error(err);
      alert('CSV 파싱/인코딩 중 오류가 발생했습니다. 엑셀에서 "CSV UTF-8(쉼표로 분리)"로 다시 저장해 주세요.');
      evt.target.value='';
    }
  };
  reader.readAsArrayBuffer(file);
}
function applyTeamRows(rows){
  const tp = state.settings.travelPolicy; initTravelMatrixIfNeeded(tp);
  const ensureOrigin = (name)=>{
    if (!tp.origins.some(o=>o.name===name)){
      tp.origins.push({ id:gen('org'), name });
      if (!tp.matrix[name]) tp.matrix[name] = {};
      if (!tp.bandMatrix[name]) tp.bandMatrix[name] = {};
    }
  };
  const ensureDestination = (name, bandGuess='근거리')=>{
    if (!tp.destinations.some(d=>d.name===name)){
      tp.destinations.push({ id:gen('dst'), name, band:bandGuess });
      Object.keys(tp.matrix).forEach(o=>{
        if (!tp.matrix[o]) tp.matrix[o]={};
        if (!tp.bandMatrix[o]) tp.bandMatrix[o]={};
        tp.matrix[o][name] = tp.matrix[o][name] ?? 20000;
        tp.bandMatrix[o][name] = tp.bandMatrix[o][name] ?? bandGuess;
      });
    }
  };

  const teams = [];
  rows.forEach((r)=>{
    const name = String(r.name||r.team_name||r.팀명||'').trim();
    const head = Math.max(0, parseNumberInput(r.headcount ?? r.인원) || 0);
    const origin = String(r.origin||r.출발지||firstOriginName()).trim();
    const rank  = TEAM_RANK_OPTIONS.includes(String(r.rankLevel||'').trim()) ? String(r.rankLevel).trim() : '사원';
    const share = Math.max(0, Math.min(100, parseNumberInput(r.customerSharePct ?? r['고객사비중(%)']) ?? 0));
    const dstC = String(r.customerDestination||r.고객사목적지||firstDestinationName()).trim();
    const dstN = String(r.nonCustomerDestination||r.비고객사목적지||firstDestinationName()).trim();
    const manual = Math.max(0, parseNumberInput(r.jobBudgetManual||r.직무예산)||0);
    if (!name) return;

    ensureOrigin(origin); ensureDestination(dstC); ensureDestination(dstN);

    teams.push({
      id: gen('team'),
      name, headcount: head,
      origin, rankLevel: rank,
      customerSharePct: share,
      customerDestination: dstC,
      nonCustomerDestination: dstN,
      jobBudgetManual: manual
    });
  });

  state.settings.teams = teams;
  persistState('Teams 업로드 완료');
  renderSettings(); renderSummary();
}

/* CSV 유틸/인코딩 */
async function decodeArrayBufferSmart(ab){
  const cands = [];
  cands.push({label:'utf-8', dec: new TextDecoder('utf-8', {fatal:false})});
  try { cands.push({label:'euc-kr', dec: new TextDecoder('euc-kr', {fatal:false})}); } catch(_){}
  try { cands.push({label:'ms949',  dec: new TextDecoder('ms949',  {fatal:false})}); } catch(_){}
  const scored = cands.map(c=>{
    const text = c.dec.decode(ab);
    return {label:c.label, text, score: scoreKoreanText(text)};
  });
  scored.sort((a,b)=> b.score - a.score);
  const best = scored[0];
  return stripBOM(best.text);
}
function scoreKoreanText(s){
  const hangul = (s.match(/[가-힣]/g) || []).length;
  const replacement = (s.match(/�/g) || []).length;
  const noise = (s.match(/[ÃÂ¤¢£¼½¾¸»ÁÉÓÚÏÐÒ™‰]/g) || []).length;
  return (hangul * 3) - (replacement * 5) - (noise * 1);
}
function stripBOM(text){ return (text && text.charCodeAt(0)===0xFEFF) ? text.slice(1) : text; }
function escapeCsv(s){ s = String(s??''); if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`; return s; }
function splitCsv(line, expected){
  const out=[]; let cur='', inQ=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (inQ){
      if (ch==='"'){ if (line[i+1]==='"'){ cur+='"'; i++; } else inQ=false; }
      else cur+=ch;
    } else {
      if (ch===','){ out.push(cur); cur=''; }
      else if (ch==='"'){ inQ=true; }
      else cur+=ch;
    }
  }
  out.push(cur);
  if (expected) while(out.length<expected) out.push('');
  return out;
}
function downloadText(text, filename, mime){
  const blob = new Blob([text], {type: mime||'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename||'download.txt';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ===================== PLAN ENTRY ===================== */
function renderPlanEntry(){
  const el = document.getElementById('planContent'); if (!el) return;
  el.innerHTML = `
    <div class="section-card">
      <div class="section-header"><div class="description">
        <h2>PLAN ENTRY</h2><p>트랙별 계획(인원×차수×단가)을 입력합니다.</p>
      </div></div>
      ${renderPlanTable('leadership','리더십',['계층','인원','차수','단가(원)'])}
      ${renderPlanTable('job','직무',['과정명','인원','차수','가중평균단가(원)','기타비용(원)','참고'])}
      ${renderPlanTable('hierarchy','직급공통',['직급','인원','차수','단가(원)'])}
      ${renderPlanTable('legal','법정',['항목','인원','차수','단가(원)'])}
      ${renderPlanTable('misc','기타',['항목','인원','차수','단가(원)','비고'])}
    </div>`;
}
function renderPlanTable(key,title,headers){
  const rows = (state.plans[key]||[]);
  return `
  <div class="plan-card">
    <div class="plan-card-header"><h3>${title} 계획</h3><button class="button button-secondary" onclick="addPlanRow('${key}')">+ 추가</button></div>
    <div class="summary-table"><table>
      <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}<th>삭제</th></tr></thead>
      <tbody>${rows.map(r=>planRowHtml(key,r)).join('')}</tbody>
    </table></div>
  </div>`;
}
function planRowHtml(key, r){
  const text = (v,cb)=>`<input type="text" value="${escapeHtml(v||'')}" onchange="${cb}(this.value)">`;
  const num  = (v,cb)=>`<div><input type="text" inputmode="numeric" value="${formatNumberInput(v||0)}" onchange="${cb}(this.value)">${hangulHintHtml(v||0)}</div>`;
  if (key==='leadership') return `<tr>
    <td>${text(r.level, `updatePlanField.bind(null,'${key}','${r.id}','level')`)}</td>
    <td>${num(r.headcount, `updatePlanNumber.bind(null,'${key}','${r.id}','headcount')`)}</td>
    <td>${num(r.rounds, `updatePlanNumber.bind(null,'${key}','${r.id}','rounds')`)}</td>
    <td>${num(r.unitCost, `updatePlanNumber.bind(null,'${key}','${r.id}','unitCost')`)}</td>
    <td><button class="button button-tertiary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`;
  if (key==='job') return `<tr>
    <td>${text(r.name, `updatePlanField.bind(null,'${key}','${r.id}','name')`)}</td>
    <td>${num(r.headcount, `updatePlanNumber.bind(null,'${key}','${r.id}','headcount')`)}</td>
    <td>${num(r.rounds, `updatePlanNumber.bind(null,'${key}','${r.id}','rounds')`)}</td>
    <td>${num(r.unitCost, `updatePlanNumber.bind(null,'${key}','${r.id}','unitCost')`)}</td>
    <td>${num(coalesce(r.otherCost, state.settings.jobDefaultOtherCost), `updatePlanNumber.bind(null,'${key}','${r.id}','otherCost')`)}</td>
    <td class="note">팀 배분은 Settings▶Travel/Teams 사용</td>
    <td><button class="button button-tertiary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`;
  if (key==='hierarchy') return `<tr>
    <td>${text(r.level, `updatePlanField.bind(null,'${key}','${r.id}','level')`)}</td>
    <td>${num(r.headcount, `updatePlanNumber.bind(null,'${key}','${r.id}','headcount')`)}</td>
    <td>${num(r.rounds, `updatePlanNumber.bind(null,'${key}','${r.id}','rounds')`)}</td>
    <td>${num(r.unitCost, `updatePlanNumber.bind(null,'${key}','${r.id}','unitCost')`)}</td>
    <td><button class="button button-tertiary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`;
  if (key==='legal') return `<tr>
    <td>${text(r.type, `updatePlanField.bind(null,'${key}','${r.id}','type')`)}</td>
    <td>${num(r.headcount, `updatePlanNumber.bind(null,'${key}','${r.id}','headcount')`)}</td>
    <td>${num(r.rounds, `updatePlanNumber.bind(null,'${key}','${r.id}','rounds')`)}</td>
    <td>${num(r.unitCost, `updatePlanNumber.bind(null,'${key}','${r.id}','unitCost')`)}</td>
    <td><button class="button button-tertiary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`;
  return `<tr>
    <td>${text(r.name, `updatePlanField.bind(null,'${key}','${r.id}','name')`)}</td>
    <td>${num(r.headcount, `updatePlanNumber.bind(null,'${key}','${r.id}','headcount')`)}</td>
    <td>${num(r.rounds, `updatePlanNumber.bind(null,'${key}','${r.id}','rounds')`)}</td>
    <td>${num(r.unitCost, `updatePlanNumber.bind(null,'${key}','${r.id}','unitCost')`)}</td>
    <td>${text(r.note||'', `updatePlanField.bind(null,'${key}','${r.id}','note')`)}</td>
    <td><button class="button button-tertiary" onclick="removePlanRow('${key}','${r.id}')">삭제</button></td></tr>`;
}
function addPlanRow(key){
  const base={ id:gen('plan'), headcount:0, rounds:1, unitCost:0 };
  if (key==='leadership') state.plans.leadership.push({ ...base, level:'중간관리자' });
  else if (key==='job') state.plans.job.push({ ...base, name:'직무 과정', otherCost: state.settings.jobDefaultOtherCost });
  else if (key==='hierarchy') state.plans.hierarchy.push({ ...base, level:'사원' });
  else if (key==='legal') state.plans.legal.push({ ...base, type:'산업안전' });
  else state.plans.misc.push({ ...base, name:'기타', note:'' });
  persistState(); renderPlanEntry(); renderSummary(); renderDashboard(); renderReport(); updateProgressTracker();
}
function removePlanRow(key,id){ state.plans[key]=(state.plans[key]||[]).filter(r=>r.id!==id); persistState(); renderPlanEntry(); renderSummary(); renderDashboard(); renderReport(); updateProgressTracker(); }
function updatePlanField(key,id,field,value){ const row=(state.plans[key]||[]).find(r=>r.id===id); if(!row) return; row[field]=value; persistState(); renderSummary(); renderDashboard(); renderReport(); }
function updatePlanNumber(key,id,field,value){ const row=(state.plans[key]||[]).find(r=>r.id===id); if(!row) return; row[field]=parseNumberInput(value)??0; persistState(); renderSummary(); renderDashboard(); renderReport(); }

/* ===================== SUMMARY 계산 ===================== */
function computeAllSummaries(){
  const S=state.settings;
  return {
    leadership: computeSimpleTrack(state.plans.leadership||[]),
    job:        computeJobTrack(state.plans.job||[], S),
    hierarchy:  computeSimpleTrack(state.plans.hierarchy||[]),
    legal:      computeSimpleTrack(state.plans.legal||[], S.legalBaseBudget, S.legalMandatoryShare),
    misc:       computeSimpleTrack(state.plans.misc||[]),
    teamAlloc:  computeTeamAllocations(S) // 자동 배분(요청 로직)
  };
}
function computeSimpleTrack(rows){
  const items = rows.map(r=>{
    const head=+r.headcount||0, rounds=+r.rounds||0, unit=+r.unitCost||0;
    const raw = head*rounds*unit;
    return { id:r.id, cost: roundWon(raw), head, rounds, unit };
  });
  return { items, total: sum(items.map(i=>i.cost)) };
}
function weightedAverageUnitCost(segments){ return sum((segments||[]).map(s=>((+s.ratio||0)/100)*(+s.unitCost||0))); }
function weightedAvgByCategory(segments){
  const acc = { 고객사:{num:0,den:0}, '고객사 외':{num:0,den:0} };
  (segments||[]).forEach(s=>{
    const r=(+s.ratio||0), u=(+s.unitCost||0), c=(s.category==='고객사'?'고객사':'고객사 외');
    acc[c].num += (r*u); acc[c].den += r;
  });
  const unitCustomer    = acc['고객사'].den>0    ? (acc['고객사'].num/acc['고객사'].den)    : 0;
  const unitNonCustomer = acc['고객사 외'].den>0 ? (acc['고객사 외'].num/acc['고객사 외'].den) : 0;
  return { unitCustomer, unitNonCustomer };
}

/* 직무 트랙 합계 (PLAN) */
function computeJobTrack(rows, S){
  const weightedUnit = weightedAverageUnitCost(S.jobSegments||[]);
  const items = rows.map(r=>{
    const head=+r.headcount||0, rounds=+r.rounds||0;
    const unit = +r.unitCost || weightedUnit;
    const other = +coalesce(r.otherCost, S.jobDefaultOtherCost) || 0;
    const raw = (head*rounds*unit) + other;
    return { id:r.id, cost: roundWon(raw), head, rounds, unit, other };
  });
  return { items, total: sum(items.map(i=>i.cost)), weightedUnit };
}

/* 출발지×목적지 비용 계산 (밴드 + 직급별 일당 반영) */
function travelCostFor(tp, originName, destName, rankLevel){
  const base = +(((tp.matrix||{})[originName]||{})[destName]||0);
  const band = getBandForPair(tp, originName, destName);
  const rules = tp.perDiemRules;

  // 기본 Per-Diem
  let perDiem = 0;
  if (rules.applyPerDiemByBand[band]){
    // 원거리일 때는 직급별 일당 우선
    if (band==='원거리' && rules.perRankByBand?.['원거리']){
      const rankPD = rules.perRankByBand['원거리'][rankLevel||''] ?? null;
      perDiem = Number.isFinite(rankPD) ? +rankPD : (+rules.perDiemByBand['원거리']||0);
    } else {
      perDiem = +rules.perDiemByBand[band] || 0;
    }
  }

  const lodging = rules.applyLodgingByBand[band] ? ((+rules.lodgingPerNight||0) * (+rules.defaultNights||0)) : 0;
  return base + perDiem + lodging;
}

/* 팀별 배분 계산
   - 고객사 교육: 수강료 0, 출장비만 × (인원 × 고객사 차수)
   - 비고객사 교육: 수강료(‘고객사 외’ 가중단가) + 출장비 × (인원 × 비고객사 차수)
   - 원거리 시 팀의 '주요 직급'에 따라 일당 사용
*/
function computeTeamAllocations(S){
  const { unitNonCustomer } = weightedAvgByCategory(S.jobSegments||[]);
  const tp = S.travelPolicy; initTravelMatrixIfNeeded(tp);
  const js = S.jobSessionsPerHead || {customer:1, nonCustomer:1};

  const rows = (S.teams||[]).map(team=>{
    const head = +team.headcount || 0;
    const sCust = +js.customer || 0;      // 고객사 차수(1인당)
    const sNon  = +js.nonCustomer || 0;   // 비고객사 차수(1인당)
    const rank  = team.rankLevel || '사원';

    // 수강료: 고객사 0, 비고객사만 적용
    const tuitionNon = roundWon(head * sNon * unitNonCustomer);
    const tuition = tuitionNon;

    // 출장비: 직급 반영(원거리)
    const costC = roundWon(travelCostFor(tp, team.origin, team.customerDestination||'', rank) * head * sCust);
    const costN = roundWon(travelCostFor(tp, team.origin, team.nonCustomerDestination||'', rank) * head * sNon);
    const travel = roundWon(costC + costN);

    const total = roundWon(tuition + travel);

    return {
      id: team.id, team: team.name, headcount: head,
      origin: team.origin, rankLevel: rank,
      customerDestination: team.customerDestination,
      nonCustomerDestination: team.nonCustomerDestination,
      sessionsCustomer: sCust, sessionsNonCustomer: sNon,
      unitNonCustomer, tuition, travel, total
    };
  });

  const totals = {
    tuition: roundWon(sum(rows.map(r=>r.tuition))),
    travel:  roundWon(sum(rows.map(r=>r.travel))),
    total:   roundWon(sum(rows.map(r=>r.total)))
  };
  return { rows, totals, sessions: S.jobSessionsPerHead };
}

/* 합계 */
function aggregateTotals(summaries){
  const totalByTrack = Object.fromEntries(Object.entries({
    leadership:summaries.leadership.total,
    job:summaries.job.total,
    hierarchy:summaries.hierarchy.total,
    legal:summaries.legal.total,
    misc:summaries.misc.total
  }).map(([k,v])=>[k, v||0]));
  return { totalByTrack, overallBudget: sum(Object.values(totalByTrack)) };
}

/* 비교(PLAN 직무 vs 팀 수기배분 합계) */
function getTeamAllocatedJobBudgetTotal(){
  const teams = (state.settings?.teams)||[];
  return teams.reduce((acc,t)=> acc + Number(t.jobBudgetManual||0), 0);
}
function getJobTrackExpectedCost(){
  const job = computeJobTrack(state.plans.job||[], state.settings);
  return job.total || 0;
}
function renderJobBudgetCompareSection(){
  const trackCost = getJobTrackExpectedCost();
  const teamAlloc = getTeamAllocatedJobBudgetTotal();
  const diff = teamAlloc - trackCost;
  const line = (k,v,bold=false)=>`
    <tr${bold?' style="font-weight:700"':''}>
      <td>${k}</td>
      <td style="text-align:right">${formatNumberInput(v)} 원</td>
      <td style="text-align:right;color:#6b7280">${toKoreanCurrencyShort(v)}</td>
    </tr>`;
  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description">
        <h2>직무교육비 요약 (트랙 예상 vs 팀별 배부)</h2>
        <p>① PLAN ENTRY의 <b>직무 트랙</b> 합계와 ② Settings&gt;Teams의 <em>직무교육비(직접배부)</em> 합계를 비교합니다.</p>
      </div>
    </div>
    <div class="summary-table">
      <table>
        <thead><tr><th>구분</th><th style="text-align:right">금액(원)</th><th style="text-align:right">한글 금액</th></tr></thead>
        <tbody>
          ${line('① 직무 트랙 예상비용(PLAN 기반)', trackCost)}
          ${line('② 팀별 직무교육비(직접배부 합계)', teamAlloc)}
          ${line('③ 차이(②-①)', diff, true)}
        </tbody>
      </table>
    </div>
    <p class="note" style="margin-top:10px;">* ①은 PLAN ENTRY의 직무 트랙 입력 합계입니다.</p>
  </div>`;
}

/* ===================== SUMMARY 렌더 ===================== */
function renderSummary(){
  const el = document.getElementById('summaryContent'); if (!el) return;
  const sums = computeAllSummaries();
  const totals = aggregateTotals(sums);
  const alloc = sums.teamAlloc;

  let html = `
    <div class="section-card">
      <div class="section-header">
        <div class="description">
          <h2>SUMMARY</h2>
          <p><b>팀별 자동 배분(안)</b>: 고객사 교육은 출장비만, 비고객사 교육은 교육비(‘고객사 외’ 가중단가) + 출장비를 <b>차수</b>·<b>직급</b> 기준으로 계산합니다.</p>
        </div>
      </div>

      <div class="metrics-grid">
        ${Object.entries(totals.totalByTrack).map(([k,v])=>`
          <div class="metric-card"><h4>${labelOf(k)} 총액</h4><p>${formatNumberInput(v)} 원<br><span class="mini">${toKoreanCurrencyShort(v)}</span></p></div>`).join('')}
        <div class="metric-card"><h4>전체 합계</h4><p>${formatNumberInput(totals.overallBudget)} 원<br><span class="mini">${toKoreanCurrencyShort(totals.overallBudget)}</span></p></div>
      </div>

      <div class="summary-table" style="margin-top:14px;">
        <h3>팀별 직무교육비 배분(안)</h3>
        <table>
          <thead>
            <tr>
              <th>팀</th><th>인원</th><th>출발지</th><th>주요 직급</th>
              <th>고객사 목적지</th><th>고객사 차수</th>
              <th>비고객사 목적지</th><th>비고객사 차수</th>
              <th>수강료 합계</th><th>출장비 합계</th><th>배분 합계</th>
            </tr>
          </thead>
          <tbody>
            ${(alloc.rows||[]).map(r=>`
              <tr>
                <td>${escapeHtml(r.team||'')}</td>
                <td>${formatNumberInput(r.headcount)}</td>
                <td>${escapeHtml(r.origin||'')}</td>
                <td>${escapeHtml(r.rankLevel||'')}</td>
                <td>${escapeHtml(r.customerDestination||'')}</td>
                <td>${r.sessionsCustomer}</td>
                <td>${escapeHtml(r.nonCustomerDestination||'')}</td>
                <td>${r.sessionsNonCustomer}</td>
                <td>${formatNumberInput(r.tuition)} 원<br><span class="mini">${toKoreanCurrencyShort(r.tuition)}</span></td>
                <td>${formatNumberInput(r.travel)} 원<br><span class="mini">${toKoreanCurrencyShort(r.travel)}</span></td>
                <td><strong>${formatNumberInput(r.total)} 원</strong><br><span class="mini">${toKoreanCurrencyShort(r.total)}</span></td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="8" style="text-align:right;">합계</th>
              <th>${formatNumberInput(alloc.totals.tuition)} 원<br><span class="mini">${toKoreanCurrencyShort(alloc.totals.tuition)}</span></th>
              <th>${formatNumberInput(alloc.totals.travel)} 원<br><span class="mini">${toKoreanCurrencyShort(alloc.totals.travel)}</span></th>
              <th>${formatNumberInput(alloc.totals.total)} 원<br><span class="mini">${toKoreanCurrencyShort(alloc.totals.total)}</span></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  html += renderJobBudgetCompareSection();
  el.innerHTML = html;
}

/* ===================== DASHBOARD/REPORT (placeholder) ===================== */
function renderDashboard(){
  const el = document.getElementById('dashboardContent'); if (!el) return;
  el.innerHTML = `
    <div class="section-card">
      <div class="section-header"><div class="description">
        <h2>DASHBOARD</h2><p>추후 차트 연동</p></div></div>
      <div class="empty-placeholder">차트 구성 예정</div>
    </div>`;
}
function renderReport(){
  const el = document.getElementById('reportContent'); if (!el) return;
  el.innerHTML = `
    <div class="section-card">
      <div class="section-header"><div class="description">
        <h2>REPORT</h2><p>경영 보고용 요약.</p></div></div>
      <div class="report-container">
        <div class="report-title">교육비 사업계획(요약)</div>
        <div class="report-subtitle">${state.settings.year||''}년 / 통화: ${escapeHtml(state.settings.currency||'KRW')}</div>
        <div class="note">SUMMARY 기준.</div>
      </div>
    </div>`;
}

/* ===================== window 바인딩 ===================== */
Object.assign(window, {
  startOnboarding, skipOnboarding, showOnboarding, switchTab,  // switchTab 추가!
  updateSetting,
  addLeadershipLevel, removeLeadershipLevel, updateLeadershipLevel,
  addJobSegment, removeJobSegment, updateJobSegment,
  addHierarchyLevel, removeHierarchyLevel, updateHierarchyLevel,
  addLegalType, removeLegalType, updateLegalType,
  addOrigin, removeOrigin, updateOriginName,
  addDestination, removeDestination, updateDestinationField,
  updateMatrixAmount, updateMatrixBand, updatePerDiemRule,
  addTeam, removeTeam, updateTeam,
  downloadTeamsTemplate, exportTeamsToCSV, triggerTeamsUpload, handleTeamsFile,
  triggerTravelXlsx, handleTravelXlsx,
  addPlanRow, removePlanRow, updatePlanField, updatePlanNumber
});

/* ===================== SETTINGS 렌더링 (누락된 핵심 함수) ===================== */
function renderSettings(){
  const el = document.getElementById('settingsContent'); 
  if (!el) return;
  
  const S = state.settings;
  const js = S.jobSessionsPerHead || {customer:1, nonCustomer:1};

  let html = `
    <div class="section-card">
      <div class="section-header">
        <div class="description">
          <h2>① 기본 설정</h2>
          <p>연도, 통화, 법정의무 예산 등 전체 시스템의 기준값을 설정합니다.</p>
        </div>
      </div>
      <div class="field-grid">
        <div class="field">
          <label>연도</label>
          <input type="number" value="${S.year||2026}" onchange="updateSetting('year', this.value)">
        </div>
        <div class="field">
          <label>통화</label>
          <input type="text" value="${escapeHtml(S.currency||'KRW')}" onchange="updateSetting('currency', this.value)">
        </div>
        <div class="field">
          <label>법정의무 기본예산(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(S.legalBaseBudget||0)}" onchange="updateSetting('legalBaseBudget', this.value)">
          ${hangulHintHtml(S.legalBaseBudget||0)}
        </div>
        <div class="field">
          <label>직무 기타비용 기본값(원)</label>
          <input type="text" inputmode="numeric" value="${formatNumberInput(S.jobDefaultOtherCost||0)}" onchange="updateSetting('jobDefaultOtherCost', this.value)">
          ${hangulHintHtml(S.jobDefaultOtherCost||0)}
        </div>
        <div class="field">
          <label>팀배분: 고객사 차수(1인당)</label>
          <input type="number" min="0" step="0.1" value="${js.customer}" onchange="updateSetting('jobSessionsCustomer', this.value)">
        </div>
        <div class="field">
          <label>팀배분: 비고객사 차수(1인당)</label>
          <input type="number" min="0" step="0.1" value="${js.nonCustomer}" onchange="updateSetting('jobSessionsNonCustomer', this.value)">
        </div>
      </div>
    </div>

    ${renderLeadershipSection(S)}
    ${renderJobSegmentSection(S)}
    ${renderHierarchySection(S)}
    ${renderLegalSection(S)}
    ${renderTravelPolicySection(S)}
    ${renderTeamSettingsSection(S)}
  `;

  el.innerHTML = html;
}

/* 각 섹션별 렌더링 헬퍼 함수들 */
function renderLeadershipSection(S){
  const rows = (S.leadershipLevels||[]).map(lv=>`
    <tr>
      <td><input type="text" value="${escapeHtml(lv.level||'')}" onchange="updateLeadershipLevel('${lv.id}','level',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.unitCost||0)}" onchange="updateLeadershipLevel('${lv.id}','unitCost',this.value)">${hangulHintHtml(lv.unitCost||0)}</td>
      <td><button class="button button-tertiary" onclick="removeLeadershipLevel('${lv.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description"><h2>② 리더십 레벨</h2><p>핵심리더, 책임리더 등 계층별 단가를 설정합니다.</p></div>
      <button class="button button-secondary" onclick="addLeadershipLevel()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>계층</th><th>단가(원)</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderJobSegmentSection(S){
  const rows = (S.jobSegments||[]).map(seg=>`
    <tr>
      <td><input type="text" value="${escapeHtml(seg.name||'')}" onchange="updateJobSegment('${seg.id}','name',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(seg.ratio||0)}" onchange="updateJobSegment('${seg.id}','ratio',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(seg.unitCost||0)}" onchange="updateJobSegment('${seg.id}','unitCost',this.value)">${hangulHintHtml(seg.unitCost||0)}</td>
      <td>
        <select onchange="updateJobSegment('${seg.id}','category',this.value)">
          <option value="고객사" ${seg.category==='고객사'?'selected':''}>고객사</option>
          <option value="고객사 외" ${seg.category!=='고객사'?'selected':''}>고객사 외</option>
        </select>
      </td>
      <td><button class="button button-tertiary" onclick="removeJobSegment('${seg.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description"><h2>③ 직무 교육 세그먼트</h2><p>OEM 프로젝트, 협력사 위탁 등 비율·단가·카테고리를 설정합니다.</p></div>
      <button class="button button-secondary" onclick="addJobSegment()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>유형명</th><th>비율(%)</th><th>단가(원)</th><th>카테고리</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderHierarchySection(S){
  const rows = (S.hierarchyLevels||[]).map(lv=>`
    <tr>
      <td><input type="text" value="${escapeHtml(lv.level||'')}" onchange="updateHierarchyLevel('${lv.id}','level',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.participation||0)}" onchange="updateHierarchyLevel('${lv.id}','participation',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(lv.unitCost||0)}" onchange="updateHierarchyLevel('${lv.id}','unitCost',this.value)">${hangulHintHtml(lv.unitCost||0)}</td>
      <td><button class="button button-tertiary" onclick="removeHierarchyLevel('${lv.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description"><h2>④ 직급 공통 교육</h2><p>사원·대리·과장·차장 이상 직급별 참여율과 단가를 설정합니다.</p></div>
      <button class="button button-secondary" onclick="addHierarchyLevel()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>직급</th><th>참여율(%)</th><th>단가(원)</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderLegalSection(S){
  const rows = (S.legalTypes||[]).map(t=>`
    <tr>
      <td><input type="text" value="${escapeHtml(t.type||'')}" onchange="updateLegalType('${t.id}','type',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(t.ratio||0)}" onchange="updateLegalType('${t.id}','ratio',this.value)"></td>
      <td><input type="text" inputmode="numeric" value="${formatNumberInput(t.unitCost||0)}" onchange="updateLegalType('${t.id}','unitCost',this.value)">${hangulHintHtml(t.unitCost||0)}</td>
      <td><button class="button button-tertiary" onclick="removeLegalType('${t.id}')">삭제</button></td>
    </tr>`).join('');

  return `
  <div class="section-card">
    <div class="section-header">
      <div class="description"><h2>⑤ 법정의무 교육</h2><p>산업안전, 개인정보보호 등 법정교육 항목별 비율과 단가를 설정합니다.</p></div>
      <button class="button button-secondary" onclick="addLegalType()">+ 추가</button>
    </div>
    <div class="summary-table"><table>
      <thead><tr><th>항목</th><th>비율(%)</th><th>단가(원)</th><th>삭제</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
```

위 코드를 원본 `script.js` 파일의 **맨 마지막** (window 바인딩 이전)에 추가하시면 됩니다.

## 📦 GitHub Pages 업로드 방법

1. **레포지토리 생성**
   - GitHub에서 새 repository 생성
   - Public으로 설정

2. **파일 업로드**
```
   your-repo/
   ├── index.html (위의 수정된 버전)
   └── script.js (renderSettings() 함수 추가된 버전)



