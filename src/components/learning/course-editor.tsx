'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { courseSchema, type Course } from '@/lib/learning/model';
import styles from './learning.module.css';
export function CourseEditor({initial,onSave,onCancel}:{initial:Course;onSave:(course:Course)=>Promise<void>;onCancel:()=>void}){
 const [course,setCourse]=useState(structuredClone(initial));const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const lesson=(index:number,key:string,value:string)=>setCourse(c=>({...c,lessons:c.lessons.map((l,i)=>i===index?{...l,[key]:value}:l)}));
 async function upload(index:number,file?:File){if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);const r=await fetch('/api/workspace/learning/file',{method:'POST',body:form});const b=await r.json();if(!r.ok)throw new Error(b.message);lesson(index,'resourceUrl',b.url);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className={styles.editor} onSubmit={async e=>{e.preventDefault();setError('');const result=courseSchema.safeParse(course);if(!result.success){setError('Add a title, story, takeaway, recall prompt, and a valid quiz for every lesson.');return;}setBusy(true);try{await onSave(result.data);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
 <h3 className="text-xl font-semibold">Edit training</h3>
 <label>Course title<input className={styles.input} value={course.title} onChange={e=>setCourse({...course,title:e.target.value})} required maxLength={150}/></label>
 <label>Short introduction<input className={styles.input} value={course.description} onChange={e=>setCourse({...course,description:e.target.value})} maxLength={600}/></label>
 {course.lessons.map((l,i)=><details key={l.id} open={course.lessons.length===1}>
 <summary>Lesson {i+1}: {l.title || 'New lesson'}</summary>
 <label>Title<input className={styles.input} value={l.title} onChange={e=>lesson(i,'title',e.target.value)} required/></label>
 <label>Story or lesson<textarea className={styles.input} rows={7} value={l.story} onChange={e=>lesson(i,'story',e.target.value)} required/></label>
 <label>What to remember<input className={styles.input} value={l.takeaway} onChange={e=>lesson(i,'takeaway',e.target.value)} required/></label>
 <label>Recall question<input className={styles.input} value={l.recall} onChange={e=>lesson(i,'recall',e.target.value)} required/></label>
 <label>PDF, video, or article link<input className={styles.input} value={l.resourceUrl} onChange={e=>lesson(i,'resourceUrl',e.target.value)} placeholder="https://…"/></label>
 <label>Or upload a PDF (15 MB max)<input type="file" accept="application/pdf" disabled={busy} className={styles.input} onChange={e=>void upload(i,e.target.files?.[0])}/></label>
 {course.lessons.length>1 && <Button variant="quiet" onClick={()=>setCourse({...course,lessons:course.lessons.filter((_,n)=>n!==i)})}>Remove lesson</Button>}
 </details>)}
 <Button variant="secondary" className="mt-4" onClick={()=>setCourse({...course,lessons:[...course.lessons,{id:crypto.randomUUID(),title:'',story:'',takeaway:'',recall:'',resourceUrl:''}]})}>Add lesson</Button>
 <h4 className="mt-8 text-lg font-semibold">Final quiz · 80% to pass</h4>
 {course.questions.map((q,i)=><details key={i}><summary>Question {i+1}: {q.prompt || 'New question'}</summary>
 <label>Question<input className={styles.input} value={q.prompt} required onChange={e=>setCourse({...course,questions:course.questions.map((v,n)=>n===i?{...v,prompt:e.target.value}:v)})}/></label>
 {q.options.map((option,j)=><label key={j}>Answer {j+1}<input className={styles.input} value={option} required onChange={e=>setCourse({...course,questions:course.questions.map((v,n)=>n===i?{...v,options:v.options.map((o,k)=>k===j?e.target.value:o)}:v)})}/></label>)}
 <label>Correct answer<select className={styles.input} value={q.answer} onChange={e=>setCourse({...course,questions:course.questions.map((v,n)=>n===i?{...v,answer:Number(e.target.value)}:v)})}>{q.options.map((_,j)=><option key={j} value={j}>Answer {j+1}</option>)}</select></label>
 <label>Why this answer is right<input className={styles.input} value={q.explanation} required onChange={e=>setCourse({...course,questions:course.questions.map((v,n)=>n===i?{...v,explanation:e.target.value}:v)})}/></label>
 {course.questions.length>1 && <Button variant="quiet" onClick={()=>setCourse({...course,questions:course.questions.filter((_,n)=>n!==i)})}>Remove question</Button>}
 </details>)}
 <Button variant="secondary" className="mt-4" onClick={()=>setCourse({...course,questions:[...course.questions,{prompt:'',options:['','',''],answer:0,explanation:''}]})}>Add question</Button>
 {error && <p role="alert" className={styles.error}>{error}</p>}
 <div className={styles.actions}><Button type="submit" disabled={busy}>{busy?'Saving…':'Save training'}</Button><Button variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Button></div>
 </form>;
}
