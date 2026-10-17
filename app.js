(() => {
  const localBank = window.QUESTION_BANK || [];
  const config = window.APP_CONFIG || { mode: 'local', supabaseUrl: '', supabaseAnonKey: '' };
  const useSupabase = config.mode === 'supabase' && config.supabaseUrl && config.supabaseAnonKey;
  const $ = (id) => document.getElementById(id);
  const views = ['homeView','examView','resultsView','reviewView'];
  const state = { count:50, minutes:90, exam:[], examId:null, current:0, answers:{}, flagged:new Set(), seconds:0, timerId:null, result:null };

  function show(view){ views.forEach(v=>$(v).classList.toggle('hidden',v!==view)); window.scrollTo({top:0,behavior:'smooth'}); }
  function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  function sample(arr,n){ return shuffle(arr).slice(0,n); }
  function getStatus(p){ if(p>=90)return ['Strong','status-strong']; if(p>=80)return ['Good','status-good']; if(p>=70)return ['Review','status-review']; if(p>=60)return ['Weak','status-weak']; return ['High Priority','status-high']; }
  function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function studentId(){ let id=localStorage.getItem('rai_student_id'); if(!id){ id=(crypto.randomUUID?crypto.randomUUID():'student-'+Date.now()+'-'+Math.random().toString(36).slice(2)); localStorage.setItem('rai_student_id',id); } return id; }

  async function api(payload){
    const url = `${config.supabaseUrl.replace(/\/$/,'')}/functions/v1/exam-api`;
    const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','apikey':config.supabaseAnonKey,'Authorization':`Bearer ${config.supabaseAnonKey}`},body:JSON.stringify(payload)});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  document.querySelectorAll('.length-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.length-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    state.count=+btn.dataset.count; state.minutes=+btn.dataset.minutes; $('timeLabel').textContent=`${state.minutes} mins`;
  }));

  function recentWeekAverage(w,history){
    const vals=history.slice(-3).map(h=>h.weeks?.[w]).filter(v=>typeof v==='number');
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }
  function weakWeight(avg){ if(avg===null)return 1.15; if(avg<60)return 2.4; if(avg<70)return 1.9; if(avg<80)return 1.5; if(avg<90)return 1.2; return 1.0; }

  function buildLocalExam(n){
    const previous=new Set(JSON.parse(localStorage.getItem('rai_last_exam_ids')||'[]'));
    const history=JSON.parse(localStorage.getItem('rai_exam_history')||'[]');
    const weeks=Array.from({length:12},(_,i)=>i+1);
    const avail=Object.fromEntries(weeks.map(w=>[w,localBank.filter(q=>q.week===w).length]));
    const minEach=n>=24?2:1;
    const quotas=Object.fromEntries(weeks.map(w=>[w,Math.min(minEach,avail[w])]));
    let remaining=n-Object.values(quotas).reduce((a,b)=>a+b,0);
    const weights=Object.fromEntries(weeks.map(w=>[w,weakWeight(recentWeekAverage(w,history))]));
    const cap=Math.max(minEach,Math.floor(n*.20));
    while(remaining>0){
      const candidates=weeks.filter(w=>quotas[w]<Math.min(cap,avail[w]));
      if(!candidates.length)break;
      const total=candidates.reduce((a,w)=>a+weights[w],0), roll=Math.random()*total;
      let acc=0,chosen=candidates[candidates.length-1];
      for(const w of candidates){acc+=weights[w];if(roll<acc){chosen=w;break;}}
      quotas[chosen]++; remaining--;
    }

    let picked=[];
    for(const w of weeks){
      const pool=localBank.filter(q=>q.week===w), quota=quotas[w];
      const original=pool.filter(q=>q.source==='assignment'), added=pool.filter(q=>q.source!=='assignment');
      const choose=(list,k,already)=>{
        const ids=new Set(already.map(x=>x.id)); const eligible=list.filter(q=>!ids.has(q.id));
        const fresh=shuffle(eligible.filter(q=>!previous.has(q.id))), repeats=shuffle(eligible.filter(q=>previous.has(q.id)));
        return [...fresh,...repeats].slice(0,k);
      };
      let chosen=choose(original,Math.min(original.length,Math.ceil(quota*.75)),[]);
      chosen.push(...choose(added,quota-chosen.length,chosen));
      chosen.push(...choose(pool,quota-chosen.length,chosen));
      picked.push(...chosen);
    }
    if(picked.length<n){const ids=new Set(picked.map(q=>q.id));picked.push(...sample(localBank.filter(q=>!ids.has(q.id)),n-picked.length));}

    return shuffle(picked.slice(0,n)).map(q=>{
      if(q.type==='numeric') return {...q};
      const shuffled=shuffle(q.opts.map((text,i)=>({text,orig:i}))); const correct=new Set(q.ans);
      return {...q,displayOpts:shuffled.map(x=>x.text),displayAns:shuffled.map((x,i)=>correct.has(x.orig)?i:null).filter(x=>x!==null)};
    });
  }

  async function startExam(){
    try{
      $('startBtn').disabled=true; $('startBtn').textContent='Generating exam…';
      state.current=0; state.answers={}; state.flagged=new Set(); state.result=null; state.seconds=state.minutes*60;
      if(useSupabase){
        const data=await api({action:'generate',studentId:studentId(),count:state.count});
        state.examId=data.examId;
        state.exam=data.questions.map(q=>({...q,displayOpts:q.opts||[]}));
      }else{
        state.examId=null;
        state.exam=buildLocalExam(state.count);
        localStorage.setItem('rai_last_exam_ids',JSON.stringify(state.exam.map(q=>q.id)));
      }
      show('examView'); renderQuestion(); renderNavigator(); updateTimer(); clearInterval(state.timerId);
      state.timerId=setInterval(()=>{state.seconds--;updateTimer();if(state.seconds<=0){clearInterval(state.timerId);submitExam(true);}},1000);
    }catch(err){ alert(`Could not generate exam: ${err.message}`); }
    finally{ $('startBtn').disabled=false; $('startBtn').textContent='Start New Final Exam →'; }
  }
  $('startBtn').addEventListener('click',startExam);

  function updateTimer(){ const m=Math.floor(state.seconds/60),s=state.seconds%60; $('timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  function answered(i){ const a=state.answers[i]; const q=state.exam[i]; return q?.type==='numeric' ? (typeof a==='string' && a.trim()!=='') : (Array.isArray(a)&&a.length>0); }

  function renderQuestion(){
    const q=state.exam[state.current]; if(!q)return;
    $('progressText').textContent=`Question ${state.current+1} of ${state.exam.length}`;
    $('progressFill').style.width=`${((state.current+1)/state.exam.length)*100}%`;
    $('questionType').textContent=q.type==='multi'?'Select all that apply':q.type==='numeric'?'Numerical answer':'Single answer';
    $('questionText').textContent=q.q; $('options').innerHTML='';
    if(q.type==='numeric'){
      const wrap=document.createElement('div'); wrap.className='numeric-wrap';
      const input=document.createElement('input'); input.type='number'; input.step='any'; input.inputMode='decimal'; input.className='numeric-input'; input.placeholder='Enter numerical answer'; input.value=state.answers[state.current]??'';
      input.addEventListener('input',()=>{state.answers[state.current]=input.value;renderNavigator();});
      wrap.appendChild(input); $('options').appendChild(wrap);
    } else {
      const selected=new Set(state.answers[state.current]||[]), letters=['A','B','C','D','E','F'];
      q.displayOpts.forEach((text,i)=>{const b=document.createElement('button');b.className='option'+(selected.has(i)?' selected':'');b.innerHTML=`<span class="letter">${letters[i]}</span><span class="option-text"></span>`;b.querySelector('.option-text').textContent=text;b.addEventListener('click',()=>selectOption(i));$('options').appendChild(b);});
    }
    $('flagBtn').classList.toggle('active',state.flagged.has(state.current)); $('flagBtn').textContent=state.flagged.has(state.current)?'⚑ Flagged':'⚑ Flag for Review';
    $('prevBtn').disabled=state.current===0; $('nextBtn').textContent=state.current===state.exam.length-1?'Review Navigator':'Next →'; renderNavigator();
  }
  function selectOption(i){const q=state.exam[state.current];if(q.type==='multi'){const a=new Set(state.answers[state.current]||[]);a.has(i)?a.delete(i):a.add(i);state.answers[state.current]=[...a].sort();}else state.answers[state.current]=[i];renderQuestion();}
  $('prevBtn').addEventListener('click',()=>{if(state.current>0){state.current--;renderQuestion();}}); $('nextBtn').addEventListener('click',()=>{if(state.current<state.exam.length-1){state.current++;renderQuestion();}}); $('flagBtn').addEventListener('click',()=>{state.flagged.has(state.current)?state.flagged.delete(state.current):state.flagged.add(state.current);renderQuestion();});
  function renderNavigator(){$('navGrid').innerHTML='';state.exam.forEach((q,i)=>{const b=document.createElement('button');b.className='navq'+(answered(i)?' answered':'')+(i===state.current?' current':'')+(state.flagged.has(i)?' flagged':'');b.textContent=i+1;b.addEventListener('click',()=>{state.current=i;renderQuestion();});$('navGrid').appendChild(b);});}

  $('submitBtn').addEventListener('click',()=>{const unanswered=state.exam.filter((_,i)=>!answered(i)).length;$('submitMessage').textContent=unanswered?`You still have ${unanswered} unanswered question${unanswered===1?'':'s'}. You can return to the exam or submit now.`:'All questions have an answer. Submit your exam and view diagnostics?';$('submitModal').classList.remove('hidden');});
  $('cancelSubmit').addEventListener('click',()=>$('submitModal').classList.add('hidden')); $('confirmSubmit').addEventListener('click',()=>{$('submitModal').classList.add('hidden');submitExam(false);});
  function sameSet(a,b){if(a.length!==b.length)return false;const x=[...a].sort((m,n)=>m-n),y=[...b].sort((m,n)=>m-n);return x.every((v,i)=>v===y[i]);}
  function numericCorrect(user,q){if(user===undefined||user===null||String(user).trim()==='')return false;const u=Number(user),a=Number(q.answer),tol=Number(q.tolerance||0);return Number.isFinite(u)&&Math.abs(u-a)<=tol;}

  async function submitExam(auto){
    clearInterval(state.timerId);
    try{
      if(useSupabase){
        const data=await api({action:'submit',studentId:studentId(),examId:state.examId,responses:state.answers});
        const rr=data.result;
        state.result={correct:rr.correct,unanswered:rr.unanswered,total:rr.total,pct:rr.pct,details:rr.details.map(d=>({index:d.index,user:d.user,ok:d.ok,q:{...d.q,displayOpts:d.q.opts,displayAns:d.q.correctDisplayIndexes,answer:d.q.numericAnswer}}))};
      }else{
        let correct=0,unanswered=0;const details=[];
        state.exam.forEach((q,i)=>{const user=state.answers[i];if(!answered(i))unanswered++;const ok=q.type==='numeric'?numericCorrect(user,q):sameSet(user||[],q.displayAns);if(ok)correct++;details.push({q,index:i,user,ok});});
        state.result={correct,unanswered,details,total:state.exam.length,pct:Math.round(correct/state.exam.length*100)};saveLocalHistory();
      }
      renderResults(auto);show('resultsView');
    }catch(err){alert(`Could not submit exam: ${err.message}`);}
  }

  function weekStats(){const stats={};for(let w=1;w<=12;w++)stats[w]={total:0,correct:0,topics:{}};state.result.details.forEach(d=>{const s=stats[d.q.week];s.total++;if(d.ok)s.correct++;if(!d.ok)s.topics[d.q.topic]=(s.topics[d.q.topic]||0)+1;});return stats;}
  function saveLocalHistory(){const stats=weekStats();const history=JSON.parse(localStorage.getItem('rai_exam_history')||'[]');history.push({date:new Date().toISOString(),score:state.result.pct,weeks:Object.fromEntries(Object.entries(stats).map(([w,s])=>[w,s.total?Math.round(s.correct/s.total*100):null]))});localStorage.setItem('rai_exam_history',JSON.stringify(history.slice(-10)));}

  function renderResults(auto){
    const r=state.result;$('scoreValue').textContent=`${r.pct}%`;$('scoreFraction').textContent=`${r.correct} / ${r.total}`;const [label,cls]=getStatus(r.pct);$('overallStatus').textContent=label;$('overallStatus').className=`score-status ${cls}`;
    $('correctCount').textContent=r.correct;$('wrongCount').textContent=r.total-r.correct;$('unansweredCount').textContent=r.unanswered;
    const original=r.details.filter(d=>d.q.source==='assignment'),origCorrect=original.filter(d=>d.ok).length;$('assignmentScore').textContent=original.length?`${Math.round(origCorrect/original.length*100)}%`:'—';
    $('diagnosticIntro').textContent=auto?'Time expired, so your exam was submitted automatically. Review the weakest weeks first.':'Your result is analyzed using hidden week/topic metadata. Your next generated exam gives extra weight to weaker weeks while still mixing the full course.';
    const stats=weekStats();$('weekPerformance').innerHTML='';const ranked=[];
    for(let w=1;w<=12;w++){const s=stats[w];const pct=s.total?Math.round(s.correct/s.total*100):0;const [lab,c]=getStatus(pct);ranked.push({w,pct,s,lab,c});const row=document.createElement('div');row.className='weekrow';row.innerHTML=`<div class="weekname">Week ${w}</div><div class="bar"><span style="width:${pct}%"></span></div><div class="pct">${pct}%</div><div class="badge ${c}">${lab}</div>`;$('weekPerformance').appendChild(row);}
    ranked.sort((a,b)=>a.pct-b.pct);$('weakAreas').innerHTML='';const weak=ranked.filter(x=>x.pct<80).slice(0,4);
    if(!weak.length){$('weakAreas').innerHTML='<div class="weak-item"><h4>No major weak week detected</h4><p>Every tested week scored at least 80%. Review individual wrong answers before another exam.</p></div>';}else weak.forEach((x,idx)=>{const topics=Object.entries(x.s.topics).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([t])=>t);const el=document.createElement('div');el.className='weak-item';el.innerHTML=`<h4>${idx+1}. Week ${x.w} — ${x.lab} (${x.pct}%)</h4><p>${x.pct<70?'Revise this week before your next full exam.':'A focused review should improve this area.'}</p><div class="chips">${topics.length?topics.map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join(''):'<span class="chip">Review core concepts</span>'}</div>`;$('weakAreas').appendChild(el);});
    const rec=document.createElement('div');rec.className='recommend';rec.innerHTML=`<b>Recommended study order:</b> ${ranked.slice(0,4).map(x=>`Week ${x.w}`).join(' → ')}`;$('weakAreas').appendChild(rec);
    renderRepeatWarning();
  }
  function renderRepeatWarning(){const box=$('repeatWarning');box.innerHTML='';if(useSupabase)return;const hist=JSON.parse(localStorage.getItem('rai_exam_history')||'[]');if(hist.length<2)return;const latest=hist.slice(-3),recurring=[];for(let w=1;w<=12;w++){const vals=latest.map(h=>h.weeks?.[w]).filter(v=>typeof v==='number');if(vals.length>=2&&vals.filter(v=>v<70).length>=2)recurring.push(w);}if(recurring.length)box.innerHTML=`<div class="recommend"><b>Repeated weak area:</b> ${recurring.map(w=>`Week ${w}`).join(', ')} scored below 70% in at least two recent exams. These weeks receive extra weight in future exams.</div>`;}

  function renderReview(){
    const wrong=state.result.details.filter(d=>!d.ok),letters=['A','B','C','D','E','F'];$('reviewList').innerHTML='';if(!wrong.length){$('reviewList').innerHTML='<div class="card review-card">Perfect score — there are no wrong answers to review.</div>';return;}
    wrong.forEach((d,k)=>{const q=d.q;let user,correct;if(q.type==='numeric'){user=answered(d.index)?String(d.user):'No answer';correct=String(q.answer);}else{user=(d.user||[]).length?(d.user||[]).map(i=>`${letters[i]}. ${q.displayOpts[i]}`).join(' / '):'No answer';correct=q.displayAns.map(i=>`${letters[i]}. ${q.displayOpts[i]}`).join(' / ');}const el=document.createElement('article');el.className='card review-card';el.innerHTML=`<div class="review-top"><span class="qtype">Wrong answer ${k+1} of ${wrong.length}</span><span class="qtype">Original Question ${d.index+1}</span></div><div class="review-q">${escapeHtml(q.q)}</div><div class="answerbox wrong"><b>Your answer:</b> ${escapeHtml(user)}</div><div class="answerbox correct"><b>Correct answer:</b> ${escapeHtml(correct)}</div><div class="explain"><b>Why:</b> ${escapeHtml(q.ex)}</div><div class="memory"><b>Remember:</b> ${escapeHtml(q.mem)}</div><div class="tagrow"><span class="tag">Week ${q.week}</span><span class="tag">${escapeHtml(q.topic)}</span><span class="tag">${q.source==='assignment'?'Original assignment':'New practice'}</span><span class="tag">${q.type==='numeric'?'Numerical':q.type==='multi'?'Multiple select':'Single select'}</span></div>`;$('reviewList').appendChild(el);});
  }
  $('newExamBtn').addEventListener('click',()=>show('homeView'));$('reviewBtn').addEventListener('click',()=>{renderReview();show('reviewView');});$('backResultsBtn').addEventListener('click',()=>show('resultsView'));
})();
