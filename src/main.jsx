import React,{useEffect,useRef,useState} from 'react';import{createRoot}from'react-dom/client';import{ShieldCheck,UserRound,Building2,ArrowRight,ArrowLeft,UploadCloud,Video,Image,FileText,CheckCircle2,AlertTriangle,Ticket,BookOpen,LayoutDashboard,History,Clock3,Plus,Trash2,Pencil,Search,Bell,ChevronDown,FileUp,Menu,X,RotateCcw,Sparkles}from'lucide-react';import'./style.css';
const initialRules=[['Claims & promises','No unsupported guarantees','Do not promise guaranteed outcomes or 100% success without approved evidence.'],['Tone of voice','Confident, clear and helpful','Avoid aggressive, insulting or exaggerated wording.'],['Visual identity','Use approved brand assets','Use current logo, colours and approved product imagery.'],['Legal & compliance','Mandatory disclaimer','Include the approved disclaimer wherever required.']];
const initialHistory=[['Summer launch reel.mp4','Video / Reel','Aarav Shah','Today, 11:42 AM','Needs review',68],['Product announcement caption','Written content','Mira Joshi','Today, 10:18 AM','Approved',96],['Website hero banner.png','Image / Post','Aarav Shah','Yesterday, 4:36 PM','Ticket raised',54],['Diwali campaign copy','Written content','Neha Patil','Yesterday, 2:05 PM','Approved',100]];
const formatBytes=bytes=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;
const Shell=({children,back})=><div className="employee"><header><button onClick={back}><ArrowLeft size={16}/> Back</button><b><ShieldCheck/> BRAND LENS <small>EMPLOYEE PORTAL</small></b><span>PROTOTYPE</span></header>{children}<footer>BRAND LENS · CONTENT VERIFICATION WORKFLOW</footer></div>;
const Status=({s})=><span className={'status '+(s==='Approved'?'ok':s==='Ticket raised'?'ticket':'pending')}>{s}</span>;
function App(){const[screen,S]=useState('home'),[tab,T]=useState('Overview'),[type,TY]=useState('video'),[file,F]=useState(null),[text,TX]=useState(''),[name,N]=useState('Employee'),[report,R]=useState(null),[rules,RR]=useState(initialRules),[history,H]=useState(initialHistory),[tickets,K]=useState([{id:'BL-1024',title:'Campaign claim requires approval',file:'Summer launch reel.mp4',status:'Open',priority:'High',note:'Product performance claim needs substantiation.'}]),[form,FM]=useState(false),[edit,E]=useState(-1),[draft,D]=useState(['','Tone of voice','']),[query,Q]=useState(''),[mobile,M]=useState(false),[toast,TO]=useState('');
const[loading,L]=useState(false),[previewUrl,PU]=useState(''),fileInput=useRef(null);
useEffect(()=>{if(!file){PU('');return}const url=URL.createObjectURL(file);PU(url);return()=>URL.revokeObjectURL(url)},[file]);

const analyse = async () => {
  if (loading) return;
  if (type === "text" ? !text.trim() : !file) {
    TO(type === "text" ? "Enter written content before analyzing." : "Choose a file before analyzing.");
    return;
  }

  L(true);
  TO("");
  try {
    let response;
    try {
      const rulePayload = rules.map(([category,title,description])=>({category,title,description}));
      const endpoint = type === "text" ? "/api/analyze" : `/api/analyze/${type}`;
      const options = type === "text"
        ? {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              content: text,
              employee_name: name,
              filename: "Written content",
              rules: rulePayload
            })
          }
        : (() => {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("employee_name", name);
            formData.append("context", text);
            formData.append("rules_json", JSON.stringify(rulePayload));
            return {method:"POST",body:formData};
          })();
      response = await fetch(`http://127.0.0.1:8000${endpoint}`, options);
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

    const issues = data.violations.map(violation=>[
      violation.severity,
      violation.title,
      violation.evidence,
      violation.recommendations.join(" ")
    ]);
    R({
      issues,
      score: data.compliance_score,
      out: data.publishing_status,
      file: data.file
    });

    H(h => [
      [
        data.file,
        "Written content",
        name,
        "Just now",
        data.violations.length ? "Needs review" : data.publishing_status === "Ready to publish" ? "Approved" : "Needs review",
        data.compliance_score
      ],
      ...h
    ]);

    S("report");

  } catch (error) {
    console.error(error);
    TO(error instanceof Error ? error.message : "Brand Lens could not analyze the content. Please try again.");
  } finally {
    L(false);
  }
};

const raise=()=>{let id='BL-'+(1024+tickets.length+1);K(k=>[{id,title:report.issues[0]?.[1]||'Manual review requested',file:report.file,status:'Open',priority:report.issues.some(x=>x[0]==='High')?'High':'Medium',note:report.issues.map(x=>x[2]).join(' ')||'Employee requested manual review.'},...k]);S('ticketdone')};
const saveRule=()=>{if(!draft[0].trim()||!draft[2].trim())return;RR(r=>edit<0?[[...draft],...r]:r.map((x,i)=>i===edit?draft:x));FM(false);E(-1);D(['','Tone of voice',''])};
const table=(rows)=><div className="tablewrap"><table><thead><tr><th>CONTENT</th><th>SUBMITTED BY</th><th>DATE</th><th>SCORE</th><th>STATUS</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td><b>{r[0]}</b><small>{r[1]}</small></td><td>{r[2]}</td><td>{r[3]}</td><td>{r[5]}/100</td><td><Status s={r[4]}/></td></tr>)}</tbody></table></div>;
const head=(title,desc)=><div className="pagehead"><div><small>BRAND LENS / COMPANY PORTAL</small><h1>{title}</h1><p>{desc}</p></div><span className="admin">CM　Company Manager⌄</span></div>;
const nav=<aside className={mobile?'side show':'side'}><b className="sidebrand"><ShieldCheck/> BRAND LENS</b><div className="workspace">AC　 Acme Corporation</div><small>WORKSPACE</small>{[['Overview',LayoutDashboard],['Raised tickets',Ticket],['Content history',History],['Rulebook',BookOpen]].map(([x,I])=><button className={tab===x?'selected':''} onClick={()=>{T(x);M(false)}}><I size={17}/>{x}</button>)}<div className="sidebottom"><p>Keep every piece of content aligned with approved standards.</p><button onClick={()=>S('home')}><ArrowLeft/> Switch portal</button></div></aside>;
const portal=<div className="portal">{nav}{mobile&&<div className="shade" onClick={()=>M(false)}/>}<main><button className="hamb" onClick={()=>M(true)}><Menu/></button>{tab==='Overview'&&<>{head('Company dashboard','A central view of your content governance pipeline.')}<div className="metrics">{[['Total submissions',128+history.length],['Approved submissions',94+history.filter(x=>x[4]==='Approved').length],['Flagged submissions',12+history.filter(x=>x[4]!=='Approved').length],['Pending human reviews',tickets.filter(x=>x.status!=='Resolved').length+3],['Resubmissions',18],['Rejected submissions',6]].map((x,i)=><div className="metric"><span>{['▤','✓','⚑','◷','↻','×'][i]}</span><small>{x[0]}</small><b>{x[1]}</b></div>)}</div><div className="cols"><section className="card"><h3>Recent submissions</h3><p>Latest content passing through verification.</p>{table(history.slice(0,4))}<button className="textbtn" onClick={()=>T('Content history')}>View history →</button></section><section className="card"><h3>Open tickets</h3><p>Items requiring management attention.</p>{tickets.map(t=><div className="ticketrow"><b>{t.title}</b><small>{t.id} · {t.file}</small><Status s={t.status}/></div>)}<button className="textbtn" onClick={()=>T('Raised tickets')}>View all →</button></section></div><div className="rulebanner"><BookOpen/><span><b>Brand rulebook</b><small>{rules.length} rules configured</small></span><button onClick={()=>T('Rulebook')}>Manage rules →</button></div></>}
{tab==='Raised tickets'&&<>{head('Raised tickets','Review escalations submitted by employees for senior management.')}{tickets.map(t=><section className="card ticketdetail"><div><b>{t.id} · {t.title}</b><Status s={t.status}/></div><p>{t.file} · {t.priority} priority</p><small>{t.note}</small><button className="action" onClick={()=>K(k=>k.map(x=>x.id===t.id?{...x,status:'Resolved'}:x))}>Mark resolved</button></section>)}</>}
{tab==='Content history'&&<>{head('Content upload history','Track submitted videos, posts and written content.') }<input className="search" placeholder="Search content or employee…" value={query} onChange={e=>Q(e.target.value)}/><section className="card">{table(history.filter(x=>x.join(' ').toLowerCase().includes(query.toLowerCase())))}</section></>}
{tab==='Rulebook'&&<>{head('Brand rulebook','Create, update and maintain rules used by content verification.') }<div className="rulebanner"><BookOpen/><span><b>Acme Corporation · Approved brand standards</b><small>Upload a PDF or create rules manually.</small></span><label className="uploadbtn"><FileUp/> Upload PDF<input type="file" accept=".pdf" onChange={e=>TO('PDF selected: '+e.target.files[0]?.name+'. Text extraction requires backend integration.')}/></label></div><div className="rulehead"><div><h3>Active rules ({rules.length})</h3><small>Manage the standards employees must follow.</small></div><button className="primary" onClick={()=>{D(['','Tone of voice','']);E(-1);FM(true)}}><Plus/> Create new rule</button></div>{form&&<section className="card ruleform"><h3>{edit<0?'Create a new rule':'Edit rule'}</h3><input placeholder="Rule title" value={draft[0]} onChange={e=>D([e.target.value,draft[1],draft[2]])}/><select value={draft[1]} onChange={e=>D([draft[0],e.target.value,draft[2]])}>{['Tone of voice','Claims & promises','Visual identity','Legal & compliance','Social media','Other'].map(x=><option>{x}</option>)}</select><textarea placeholder="Describe the rule…" value={draft[2]} onChange={e=>D([draft[0],draft[1],e.target.value])}/><button className="primary" onClick={saveRule}>Save rule</button><button className="action" onClick={()=>FM(false)}>Cancel</button></section>}{rules.map((r,i)=><section className="card rule"><div><small>{r[1]}</small><b>{r[0]}</b><p>{r[2]}</p></div><button onClick={()=>{D(r);E(i);FM(true)}}><Pencil/></button><button onClick={()=>RR(v=>v.filter((_,j)=>i!==j))}><Trash2/></button></section>)}</>}
<footer className="portalfoot">BRAND LENS · COMPANY PORTAL <span>HACKATHON PROTOTYPE</span></footer></main>{toast&&<div className="toast">{toast}<button onClick={()=>TO('')}>×</button></div>}</div>;
return <>{screen==='home'&&<div className="landing"><header><b><ShieldCheck/> BRAND LENS <small>CONTENT GOVERNANCE PLATFORM</small></b><span>● HACKATHON PROTOTYPE</span></header><article><small>THE BRAND CONTENT VERIFICATION SYSTEM</small><h1>Every piece of content.<br/><em>One standard of trust.</em></h1><p>A single place to verify brand content, enforce approved guidelines and escalate uncertain decisions before anything gets published.</p><label>CHOOSE YOUR WORKSPACE TO CONTINUE</label><div className="roles"><button onClick={()=>S('upload')}><UserRound/><small>FOR CONTENT CREATORS</small><h2>Employee portal</h2><p>Submit a reel, post, video or written copy. Get a verification report and know whether it is ready to publish.</p><b>Open employee portal <ArrowRight/></b></button><button onClick={()=>{T('Overview');S('company')}}><Building2/><small>FOR BRAND & MANAGEMENT</small><h2>Company portal</h2><p>Monitor submissions, review escalated tickets, track upload history and manage the organisation’s brand rulebook.</p><b>Open company dashboard <ArrowRight/></b></button></div><div className="trust">✓ Rule-based verification　　✓ Human escalation　　✓ Central rulebook</div></article><footer>BRAND LENS © 2026 <span>BUILT FOR RESPONSIBLE BRAND COMMUNICATION</span></footer></div>}
{screen==='upload'&&<Shell back={()=>S('home')}><div className="empwrap"><small>EMPLOYEE WORKFLOW　 /　 01 SUBMIT</small><h1>Submit your content</h1><p>Before you publish, let Brand Lens check your content against your company’s approved brand rules.</p><section className="card"><label>YOUR NAME</label><input value={name} onChange={e=>N(e.target.value)}/><label>WHAT ARE YOU SUBMITTING?</label><div className="types">{[['video',Video,'Video / Reel'],['image',Image,'Image / Post'],['text',FileText,'Written content']].map(([v,I,l])=><button className={type===v?'chosen':''} onClick={()=>{TY(v);F(null);if(fileInput.current)fileInput.current.value=''}}><I/><b>{l}</b></button>)}</div>{type==='text'?<><label>PASTE YOUR CONTENT</label><textarea value={text} onChange={e=>TX(e.target.value)} placeholder="Paste the exact text you intend to publish…"/></>:<><label>UPLOAD YOUR {type==='video'?'VIDEO':'IMAGE'}</label><label className="drop">{file&&previewUrl?(type==='image'?<img src={previewUrl} alt={file.name} style={{maxWidth:'100%',maxHeight:220,objectFit:'contain'}}/>:<video src={previewUrl} controls style={{maxWidth:'100%',maxHeight:220}}/>):<UploadCloud/>}<b>{file?.name||'Drop your file here, or browse'}</b><small>{file?formatBytes(file.size):type==='video'?'MP4, MOV, WEBM':'JPG, JPEG, PNG, WEBP'}</small><input ref={fileInput} type="file" accept={type==='video'?'.mp4,.mov,.webm':'.jpg,.jpeg,.png,.webp'} onChange={e=>{F(e.target.files?.[0]||null);e.target.value=''}}/><u>{file?'Replace file':'Choose file'}</u></label>{file&&<button className="action" type="button" onClick={()=>{F(null);if(fileInput.current)fileInput.current.value=''}}>Remove selected file</button>}<label>CAPTION OR CONTEXT (OPTIONAL)</label><textarea value={text} onChange={e=>TX(e.target.value)} placeholder="Add accompanying caption…"/></>}<button className="primary wide" disabled={loading||(type==='text'?!text.trim():!file)} onClick={analyse}>{loading?'Analyzing…':'Verify my content'} {!loading&&<ArrowRight/>}</button><small className="hint">Your submission is checked against the company rulebook.</small></section></div></Shell>}
{screen==='report'&&<Shell back={()=>S('upload')}><div className="empwrap"><small>EMPLOYEE WORKFLOW　 /　 03 REPORT</small><h1>Your verification report</h1><p>Checking <b>{report.file}</b> against the approved company rulebook.</p><section className="card report"><div className="score"><b>{report.score??'—'}</b><small>COMPLIANCE SCORE</small></div><div><span className={report.out==='Ready to publish'?'good':'warning'}>{report.out}</span><h2>{report.out==='Ready to publish'?'Your content is ready to publish.':report.out}</h2><p>{report.issues.length?'Review the findings, correct and resubmit, or raise a ticket to senior management.':report.out==='Ready to publish'?'No violations were found against the configured rules.':'The analysis could not establish a reliable result; request human review.'}</p></div></section><section className="card"><h3>Verification findings</h3>{report.issues.length?report.issues.map(x=><div className="finding"><b>{x[0]} RISK · {x[1]}</b><p>{x[2]}</p><small>Suggested fix: {x[3]}</small></div>):<p className={report.out==='Ready to publish'?'good':'warning'}>{report.out==='Ready to publish'?'✓ No violations detected.':'A human review is recommended; the evidence was inconclusive.'}</p>}</section><div className="reportactions">{report.out!=='Ready to publish'?<><button className="action" onClick={()=>{F(null);TX('');S('upload')}}><RotateCcw/> Correct & reupload</button><button className="primary" onClick={raise}><Ticket/> Raise ticket to management</button></>:<button className="primary" onClick={()=>S('home')}>Finish</button>}</div><p className="hint">Analysis is generated from the configured brand rules and the submitted text, image, or sampled video frames.</p></div></Shell>}
{screen==='ticketdone'&&<Shell back={()=>S('home')}><div className="empwrap"><section className="card done"><CheckCircle2/><h1>Your ticket has been raised.</h1><p>Your content and verification findings have been sent to senior management.</p><b>{tickets[0].id}</b><small>OPEN — AWAITING REVIEW</small><button className="primary" onClick={()=>S('home')}>Back to portal selection</button></section></div></Shell>}
{screen==='company'&&portal}</>}
createRoot(document.getElementById('root')).render(<App/>);