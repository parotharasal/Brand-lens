import React,{useEffect,useRef,useState} from 'react';import{createRoot}from'react-dom/client';import{ShieldCheck,UserRound,Building2,ArrowRight,ArrowLeft,UploadCloud,Video,Image,FileText,CheckCircle2,AlertTriangle,Ticket,BookOpen,LayoutDashboard,History,Clock3,Plus,Trash2,Pencil,Search,Bell,ChevronDown,FileUp,Menu,X,RotateCcw,Sparkles}from'lucide-react';import'./style.css';
const initialRules=[['Claims & promises','No unsupported guarantees','Do not promise guaranteed outcomes or 100% success without approved evidence.'],['Tone of voice','Confident, clear and helpful','Avoid aggressive, insulting or exaggerated wording.'],['Visual identity','Use approved brand assets','Use current logo, colours and approved product imagery.'],['Legal & compliance','Mandatory disclaimer','Include the approved disclaimer wherever required.']];
const API_BASE='http://127.0.0.1:8000';
const apiRequest=async(path,options={})=>{const response=await fetch(`${API_BASE}${path}`,options);if(!response.ok){let detail='';try{detail=(await response.json()).detail||''}catch{}throw new Error(detail||`Request failed (${response.status}).`)}return response.json()};
const submissionHistory=row=>[row.filename,row.content_type==='text'?'Written content':row.content_type==='image'?'Image / Post':'Video / Reel',row.employee_name,new Date(row.created_at||Date.now()).toLocaleString(),row.analysis_status==='pending'?'Pending review':row.analysis_status==='processing'?'Analyzing':row.analysis_status==='failed'?'Analysis failed':row.violations?.length?'Needs review':row.publishing_status==='Ready to publish'?'Approved':'Needs review',row.compliance_score,row.id];
const ticketView=row=>({...row,status:String(row.status||'Open').toLowerCase()==='resolved'?'Resolved':'Open',displayId:`BL-${row.ticket_number}`});
const formatBytes=bytes=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;
const Shell=({children,back})=><div className="employee"><header><button onClick={back}><ArrowLeft size={16}/> Back</button><b><ShieldCheck/> BRAND LENS <small>EMPLOYEE PORTAL</small></b><span>PROTOTYPE</span></header>{children}<footer>BRAND LENS · CONTENT VERIFICATION WORKFLOW</footer></div>;
const Status=({s})=><span className={'status '+(s==='Approved'?'ok':s==='Ticket raised'?'ticket':'pending')}>{s}</span>;
function App(){const[screen,S]=useState('home'),[tab,T]=useState('Overview'),[type,TY]=useState('video'),[file,F]=useState(null),[text,TX]=useState(''),[name,N]=useState('Employee'),[report,R]=useState(null),[rules,RR]=useState(initialRules),[history,H]=useState([]),[tickets,K]=useState([]),[form,FM]=useState(false),[edit,E]=useState(-1),[draft,D]=useState(['','Tone of voice','']),[query,Q]=useState(''),[mobile,M]=useState(false),[toast,TO]=useState('');
const[loading,L]=useState(false),[previewUrl,PU]=useState(''),fileInput=useRef(null),submissionLock=useRef(false);
useEffect(()=>{if(!file){PU('');return}const url=URL.createObjectURL(file);PU(url);return()=>URL.revokeObjectURL(url)},[file]);
useEffect(()=>{if(screen!=='company')return;let active=true;const refresh=()=>Promise.all([apiRequest('/api/rules'),apiRequest('/api/submissions'),apiRequest('/api/tickets')]).then(([ruleRows,submissionRows,ticketRows])=>{if(!active)return;RR(ruleRows.map(row=>[row.category,row.title,row.description,row.id]));H(submissionRows.map(submissionHistory));K(ticketRows.map(ticketView))});refresh().catch(error=>{if(active)TO(error.message)});const events=new EventSource(`${API_BASE}/api/events`);events.addEventListener('change',()=>{refresh().catch(error=>{if(active)TO(error.message)})});events.onerror=()=>{if(active)TO('Live updates are reconnecting. Check the Supabase Realtime setup if this continues.')};return()=>{active=false;events.close()}},[screen]);
const analyse = async () => {
  if (submissionLock.current || loading) return;
  if (type === "text" ? !text.trim() : !file) {
    TO(type === "text" ? "Enter written content before analyzing." : "Choose a file before analyzing.");
    return;
  }

  submissionLock.current = true;
  L(true);
  TO("");
  try {
    let response;
    try {
      const endpoint = type === "text" ? "/api/submissions" : `/api/analyze/${type}`;
      const options = type === "text"
        ? {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              content: text,
              content_type: "text",
              employee_name: name,
              filename: "Written content",
            })
          }
        : (() => {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("employee_name", name);
            formData.append("context", text);
            return {method:"POST",body:formData};
          })();
          response = await fetch(`${API_BASE}${endpoint}`, options);
    } catch {
      throw new Error("Cannot connect to Brand Lens backend at http://127.0.0.1:8000. Confirm the API server is running.");
    }

    if (!response.ok) {
      let detail = "";
      try {
        const errorData = await response.json();
        detail = Array.isArray(errorData.detail)
          ? errorData.detail.map(error => error.msg).join("; ")
          : errorData.detail || errorData.message || "";
      } catch {
        // Use the HTTP status when the server does not return a JSON error body.
      }
      throw new Error(`Analysis failed (${response.status})${detail ? `: ${detail}` : "."}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error("Analysis unsuccessful");
    }

    const violations = Array.isArray(data.violations) ? data.violations : [];
    const rawSuggestions = Array.isArray(data.suggested_corrections)
      ? data.suggested_corrections
      : Array.isArray(data.recommendations) ? data.recommendations : [];
    const suggestions = rawSuggestions.map(suggestion => typeof suggestion === "string"
      ? suggestion
      : JSON.stringify(suggestion));
    const issues = violations.map(violation => typeof violation === "string"
      ? ["Review", "Potential violation", violation, suggestions.join(" ")]
      : violation && typeof violation === "object" ? [
          typeof violation.severity === "string" ? violation.severity : "Review",
          typeof violation.title === "string" ? violation.title : "Potential violation",
          typeof violation.evidence === "string"
            ? violation.evidence
            : typeof violation.description === "string" ? violation.description : "",
          Array.isArray(violation.recommendations)
            ? violation.recommendations.filter(item => typeof item === "string").join(" ") || suggestions.join(" ")
            : typeof violation.recommendations === "string" ? violation.recommendations : suggestions.join(" "),
        ] : ["Review", "Potential violation", String(violation), suggestions.join(" ")]);
    R({
      issues,
      score: data.compliance_score ?? data.score,
      out: data.status || data.publishing_status,
      file: data.file,
      submissionId: data.submission_id,
      aiFeedback: data.ai_feedback || data.feedback || "",
      suggestions,
      directAnalysis: Boolean(data.direct_analysis) || (type === "text" && !data.submission_id),
      analysis_status: data.analysis_status,
      historyError: data.history_error,
    });

    if (type !== "text") {
      H(h => [submissionHistory({id:data.submission_id,filename:data.file,content_type:type,employee_name:name,created_at:new Date().toISOString(),violations,publishing_status:data.publishing_status,compliance_score:data.compliance_score}),...h]);
    } else if (data.history_saved) {
      H(h => [submissionHistory({id:data.submission_id,filename:data.file,content_type:'text',employee_name:name,created_at:new Date().toISOString(),analysis_status:data.analysis_status||'completed',violations,publishing_status:data.publishing_status,compliance_score:data.compliance_score}),...h]);
    }

    S("report");
    if (data.history_error) TO(data.history_error);

  } catch (error) {
    console.error(error);
    TO(error instanceof Error ? error.message : "Brand Lens could not analyze the content. Please try again.");
  } finally {
    submissionLock.current = false;
    L(false);
  }
};

const raise=async()=>{try{const row=await apiRequest('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submission_id:report.submissionId,title:report.issues[0]?.[1]||'Manual review requested',filename:report.file,priority:report.issues.some(x=>x[0]==='High')?'High':'Medium',note:report.issues.map(x=>x[2]).join(' ')||'Employee requested manual review.'})});K(k=>[ticketView(row),...k]);S('ticketdone')}catch(error){TO(error.message)}};
const saveRule=async()=>{if(!draft[0].trim()||!draft[2].trim())return;const payload={title:draft[0],category:draft[1],description:draft[2]};try{const row=await apiRequest(edit<0?'/api/rules':`/api/rules/${rules[edit][3]}`,{method:edit<0?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});RR(r=>edit<0?[[row.category,row.title,row.description,row.id],...r]:r.map((x,i)=>i===edit?[row.category,row.title,row.description,row.id]:x));FM(false);E(-1);D(['','Tone of voice',''])}catch(error){TO(error.message)}};
const removeRule=async(index)=>{try{await apiRequest(`/api/rules/${rules[index][3]}`,{method:'DELETE'});RR(r=>r.filter((_,i)=>i!==index))}catch(error){TO(error.message)}};
const resolveTicket=async(ticket)=>{try{const row=await apiRequest(`/api/tickets/${ticket.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'Resolved'})});K(k=>k.map(item=>item.id===ticket.id?ticketView(row):item))}catch(error){TO(error.message)}};
const table=(rows)=><div className="tablewrap"><table><thead><tr><th>CONTENT</th><th>SUBMITTED BY</th><th>DATE</th><th>SCORE</th><th>STATUS</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td><b>{r[0]}</b><small>{r[1]}</small></td><td>{r[2]}</td><td>{r[3]}</td><td>{r[5]}/100</td><td><Status s={r[4]}/></td></tr>)}</tbody></table></div>;
const head=(title,desc)=><div className="pagehead"><div><small>BRAND LENS / COMPANY PORTAL</small><h1>{title}</h1><p>{desc}</p></div><span className="admin">CM　Company Manager⌄</span></div>;
const nav=<aside className={mobile?'side show':'side'}><b className="sidebrand"><ShieldCheck/> BRAND LENS</b><div className="workspace">AC　 Acme Corporation</div><small>WORKSPACE</small>{[['Overview',LayoutDashboard],['Raised tickets',Ticket],['Content history',History],['Rulebook',BookOpen]].map(([x,I])=><button className={tab===x?'selected':''} onClick={()=>{T(x);M(false)}}><I size={17}/>{x}</button>)}<div className="sidebottom"><p>Keep every piece of content aligned with approved standards.</p><button onClick={()=>S('home')}><ArrowLeft/> Switch portal</button></div></aside>;
const portal=<div className="portal">{nav}{mobile&&<div className="shade" onClick={()=>M(false)}/>}<main><button className="hamb" onClick={()=>M(true)}><Menu/></button>{tab==='Overview'&&<>{head('Company dashboard','A central view of your content governance pipeline.')}<div className="metrics">{[['Total submissions',history.length],['Approved submissions',history.filter(x=>x[4]==='Approved').length],['Flagged submissions',history.filter(x=>x[4]!=='Approved').length],['Pending human reviews',tickets.filter(x=>x.status!=='Resolved').length],['Resubmissions',0],['Rejected submissions',0]].map((x,i)=><div className="metric"><span>{['▤','✓','⚑','◷','↻','×'][i]}</span><small>{x[0]}</small><b>{x[1]}</b></div>)}</div><div className="cols"><section className="card"><h3>Recent submissions</h3><p>Latest content passing through verification.</p>{table(history.slice(0,4))}<button className="textbtn" onClick={()=>T('Content history')}>View history →</button></section><section className="card"><h3>Open tickets</h3><p>Items requiring management attention.</p>{tickets.map(t=><div className="ticketrow"><b>{t.title}</b><small>{t.displayId} · {t.filename}</small><Status s={t.status}/></div>)}<button className="textbtn" onClick={()=>T('Raised tickets')}>View all →</button></section></div><div className="rulebanner"><BookOpen/><span><b>Brand rulebook</b><small>{rules.length} rules configured</small></span><button onClick={()=>T('Rulebook')}>Manage rules →</button></div></>}
{tab==='Raised tickets'&&<>{head('Raised tickets','Review escalations submitted by employees for senior management.')}{tickets.map(t=><section className="card ticketdetail"><div><b>{t.displayId} · {t.title}</b><Status s={t.status}/></div><p>{t.filename} · {t.priority} priority</p><small>{t.note}</small><button className="action" onClick={()=>resolveTicket(t)}>Mark resolved</button></section>)}</>}
{tab==='Content history'&&<>{head('Content upload history','Track submitted videos, posts and written content.') }<input className="search" placeholder="Search content or employee…" value={query} onChange={e=>Q(e.target.value)}/><section className="card">{table(history.filter(x=>x.join(' ').toLowerCase().includes(query.toLowerCase())))}</section></>}
{tab==='Rulebook'&&<>{head('Brand rulebook','Create, update and maintain rules used by content verification.') }<div className="rulebanner"><BookOpen/><span><b>Acme Corporation · Approved brand standards</b><small>Upload a PDF or create rules manually.</small></span><label className="uploadbtn"><FileUp/> Upload PDF<input type="file" accept=".pdf" onChange={e=>TO('PDF selected: '+e.target.files[0]?.name+'. Text extraction requires backend integration.')}/></label></div><div className="rulehead"><div><h3>Active rules ({rules.length})</h3><small>Manage the standards employees must follow.</small></div><button className="primary" onClick={()=>{D(['','Tone of voice','']);E(-1);FM(true)}}><Plus/> Create new rule</button></div>{form&&<section className="card ruleform"><h3>{edit<0?'Create a new rule':'Edit rule'}</h3><input placeholder="Rule title" value={draft[0]} onChange={e=>D([e.target.value,draft[1],draft[2]])}/><select value={draft[1]} onChange={e=>D([draft[0],e.target.value,draft[2]])}>{['Tone of voice','Claims & promises','Visual identity','Legal & compliance','Social media','Other'].map(x=><option>{x}</option>)}</select><textarea placeholder="Describe the rule…" value={draft[2]} onChange={e=>D([draft[0],draft[1],e.target.value])}/><button className="primary" onClick={saveRule}>Save rule</button><button className="action" onClick={()=>FM(false)}>Cancel</button></section>}{rules.map((r,i)=><section className="card rule"><div><small>{r[1]}</small><b>{r[0]}</b><p>{r[2]}</p></div><button onClick={()=>{D(r);E(i);FM(true)}}><Pencil/></button><button onClick={()=>removeRule(i)}><Trash2/></button></section>)}</>}
<footer className="portalfoot">BRAND LENS · COMPANY PORTAL <span>HACKATHON PROTOTYPE</span></footer></main>{toast&&<div className="toast">{toast}<button onClick={()=>TO('')}>×</button></div>}</div>;
return <>{toast&&screen!=='company'&&<div className="toast" role="alert">{toast}<button aria-label="Dismiss message" onClick={()=>TO('')}>×</button></div>}{screen==='home'&&<div className="landing"><header><b><ShieldCheck/> BRAND LENS <small>CONTENT GOVERNANCE PLATFORM</small></b><span>● HACKATHON PROTOTYPE</span></header><article><small>THE BRAND CONTENT VERIFICATION SYSTEM</small><h1>Every piece of content.<br/><em>One standard of trust.</em></h1><p>A single place to verify brand content, enforce approved guidelines and escalate uncertain decisions before anything gets published.</p><label>CHOOSE YOUR WORKSPACE TO CONTINUE</label><div className="roles"><button onClick={()=>S('upload')}><UserRound/><small>FOR CONTENT CREATORS</small><h2>Employee portal</h2><p>Submit a reel, post, video or written copy. Get a verification report and know whether it is ready to publish.</p><b>Open employee portal <ArrowRight/></b></button><button onClick={()=>{T('Overview');S('company')}}><Building2/><small>FOR BRAND & MANAGEMENT</small><h2>Company portal</h2><p>Monitor submissions, review escalated tickets, track upload history and manage the organisation’s brand rulebook.</p><b>Open company dashboard <ArrowRight/></b></button></div><div className="trust">✓ Rule-based verification　　✓ Human escalation　　✓ Central rulebook</div></article><footer>BRAND LENS © 2026 <span>BUILT FOR RESPONSIBLE BRAND COMMUNICATION</span></footer></div>}
{screen==='upload'&&<Shell back={()=>S('home')}><div className="empwrap"><small>EMPLOYEE WORKFLOW　 /　 01 SUBMIT</small><h1>Submit your content</h1><p>Submit written content for review, or check image and video content against your company’s approved brand rules.</p><section className="card"><label>YOUR NAME</label><input value={name} onChange={e=>N(e.target.value)}/><label>WHAT ARE YOU SUBMITTING?</label><div className="types">{[['video',Video,'Video / Reel'],['image',Image,'Image / Post'],['text',FileText,'Written content']].map(([v,I,l])=><button className={type===v?'chosen':''} onClick={()=>{TY(v);F(null);if(fileInput.current)fileInput.current.value=''}}><I/><b>{l}</b></button>)}</div>{type==='text'?<><label>PASTE YOUR CONTENT</label><textarea value={text} onChange={e=>TX(e.target.value)} placeholder="Paste the exact text you intend to publish…"/></>:<><label>UPLOAD YOUR {type==='video'?'VIDEO':'IMAGE'}</label><label className="drop">{file&&previewUrl?(type==='image'?<img src={previewUrl} alt={file.name} style={{maxWidth:'100%',maxHeight:220,objectFit:'contain'}}/>:<video src={previewUrl} controls style={{maxWidth:'100%',maxHeight:220}}/>):<UploadCloud/>}<b>{file?.name||'Drop your file here, or browse'}</b><small>{file?formatBytes(file.size):type==='video'?'MP4, MOV, WEBM':'JPG, JPEG, PNG, WEBP'}</small><input ref={fileInput} type="file" accept={type==='video'?'.mp4,.mov,.webm':'.jpg,.jpeg,.png,.webp'} onChange={e=>{F(e.target.files?.[0]||null);e.target.value=''}}/><u>{file?'Replace file':'Choose file'}</u></label>{file&&<button className="action" type="button" onClick={()=>{F(null);if(fileInput.current)fileInput.current.value=''}}>Remove selected file</button>}<label>CAPTION OR CONTEXT (OPTIONAL)</label><textarea value={text} onChange={e=>TX(e.target.value)} placeholder="Add accompanying caption…"/></>}<button className="primary wide" disabled={loading} onClick={analyse}>{loading?(type==='text'?'Saving...':'Analyzing...'):(type==='text'?'Submit for review':'Verify my content')} {!loading&&<ArrowRight/>}</button><small className="hint">{type==='text'?'Submit your written content to save it in Supabase for review.':'Select a file before verifying image or video content.'}</small></section></div></Shell>}
{screen==='report'&&<Shell back={()=>S('upload')}><div className="empwrap"><small>EMPLOYEE WORKFLOW　 /　 03 REPORT</small><h1>Your verification report</h1><p>{report.analysis_status==='pending'?'Your submission has been saved for review.':<>Checking <b>{report.file}</b> against the approved company rulebook.</>}</p>{['pending','processing'].includes(report.analysis_status)?<section className="card report"><div className="score"><b>…</b><small>COMPLIANCE SCORE</small></div><div><span className="warning">Awaiting review</span><h2>Submission received.</h2><p>Your text has been saved to Supabase and is awaiting review.</p><button className="primary" onClick={()=>S('home')}>Finish</button></div></section>:<><section className="card report"><div className="score"><b>{report.score??'—'}</b><small>COMPLIANCE SCORE</small></div><div><span className={report.out==='Approved'||report.out==='Ready to publish'?'good':'warning'}>{report.out}</span><h2>{report.out==='Approved'?'Your content is approved.':report.out==='Ready to publish'?'Your content is ready to publish.':report.out==='Flagged'?'Your content was flagged for review.':report.out}</h2><p>{report.issues.length?'Review the findings and suggested corrections below.':report.out==='Approved'||report.out==='Ready to publish'?'No violations were found against the configured rules.':'A human review is recommended based on this analysis.'}</p></div></section>{report.aiFeedback&&<section className="card"><h3>AI feedback</h3><p>{report.aiFeedback}</p></section>}<section className="card"><h3>Verification findings</h3>{report.issues.length?report.issues.map(x=><div className="finding"><b>{x[0]} RISK · {x[1]}</b><p>{x[2]}</p>{x[3]&&<small>Suggested fix: {x[3]}</small>}</div>):<p className={report.out==='Approved'||report.out==='Ready to publish'?'good':'warning'}>{report.out==='Approved'||report.out==='Ready to publish'?'✓ No violations detected.':'A human review is recommended; the evidence was inconclusive.'}</p>}</section>{report.suggestions?.length>0&&<section className="card"><h3>Suggested corrections</h3>{report.suggestions.map((suggestion,index)=><p key={index}>{suggestion}</p>)}</section>}<div className="reportactions">{report.out!=='Approved'&&report.out!=='Ready to publish'?<><button className="action" onClick={()=>{F(null);TX('');S('upload')}}><RotateCcw/> Correct & reupload</button>{report.directAnalysis?<button className="primary" onClick={()=>S('home')}>Finish</button>:<button className="primary" onClick={raise}><Ticket/> Raise ticket to management</button>}</>:<button className="primary" onClick={()=>S('home')}>Finish</button>}</div></>}<p className="hint">{report.analysis_status==='pending'?'Submission saved in Supabase for review.':'Analysis is generated from the configured brand rules and the submitted image or sampled video frames.'}</p></div></Shell>}
{screen==='ticketdone'&&<Shell back={()=>S('home')}><div className="empwrap"><section className="card done"><CheckCircle2/><h1>Your ticket has been raised.</h1><p>Your content and verification findings have been sent to senior management.</p><b>{tickets[0].displayId}</b><small>OPEN — AWAITING REVIEW</small><button className="primary" onClick={()=>S('home')}>Back to portal selection</button></section></div></Shell>}
{screen==='company'&&portal}</>}
createRoot(document.getElementById('root')).render(<App/>);