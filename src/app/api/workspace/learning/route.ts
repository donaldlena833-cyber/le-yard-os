import { z } from 'zod';
import { checklistSchema, courseSchema, gradeExam, learningDay } from '@/lib/learning/model';
import { starterChecklists } from '@/lib/learning/starter';
import { LearningAccessError, canEditLearning, getCourse, learningHeaders, learningQuery, learningWorkspace, ownLearningRecords, saveLearning } from '@/lib/learning/server';
const requestSchema = z.discriminatedUnion('action',[
  z.object({action:z.literal('course'),course:courseSchema}),
  z.object({action:z.literal('template'),template:checklistSchema}),
  z.object({action:z.literal('lesson'),courseId:z.string().max(80),courseRevision:z.string().max(80),lessonId:z.string().max(80)}),
  z.object({action:z.literal('exam'),courseId:z.string().max(80),courseRevision:z.string().max(80),answers:z.array(z.number().int().min(0).max(3)).max(20)}),
  z.object({action:z.literal('tick'),kind:z.enum(['opening','closing']),date:z.string(),itemId:z.string().max(80),done:z.boolean()}),
  z.object({action:z.literal('note'),kind:z.enum(['opening','closing']),date:z.string(),text:z.string().max(2000)}),
]);
const json = (body:object,status=200)=>Response.json(body,{status,headers:learningHeaders});
export async function GET(){
  try {
    const w = await learningWorkspace();
    const today = learningDay(w.activeLocation.timeZone ?? "America/New_York");
    const personal = learningQuery(w).in('kind',['lesson','exam']).eq('updated_by',w.identity.userId).order('updated_at',{ascending:false}).limit(2000);
    const results = await Promise.all([
      learningQuery(w).in('kind',['course','template']).order('updated_at',{ascending:false}).limit(200),
      personal,
      learningQuery(w).in('kind',['tick','note']).like('record_key',`${today}:%`).order('updated_at',{ascending:false}).limit(500),
      canEditLearning(w) ? learningQuery(w).eq('kind','exam').order('updated_at',{ascending:false}).limit(500) : Promise.resolve({data:[],error:null}),
    ]);
    if(results.some(r=>r.error)) throw new Error('Learning could not be loaded. Try again.');
    const unique = new Map(results.flatMap(r=>r.data ?? []).map(r=>[`${r.kind}:${r.record_key}`,r]));
    return json({records:ownLearningRecords([...unique.values()] as Parameters<typeof ownLearningRecords>[0],w),date:today,canEdit:canEditLearning(w),userId:w.identity.userId});
  } catch(error){return json({message:error instanceof Error ? error.message : 'Could not load learning.'},error instanceof LearningAccessError?error.status:503);}
}
export async function POST(request:Request){
  if(request.headers.get('origin') !== new URL(request.url).origin) return json({message:'Request not allowed.'},403);
  try {
    const w = await learningWorkspace();
    if(w.mode !== 'live') return json({message:'Preview only. Open the live workspace to save.'},400);
    const raw = await request.text();
    if(raw.length > 400000) return json({message:'This lesson is too large.'},413);
    const input = requestSchema.parse(JSON.parse(raw));
    if(input.action === 'course' || input.action === 'template') {
      if(!canEditLearning(w)) return json({message:'Ask a manager to edit shared material.'},403);
      if(input.action === 'course') await saveLearning(w,'course',input.course.id,{...input.course,revision:crypto.randomUUID()});
      else await saveLearning(w,'template',input.template.kind,input.template);
    } else if(input.action === 'lesson' || input.action === 'exam') {
      const course = await getCourse(w,input.courseId);
      if(input.courseRevision !== course.revision) return json({message:'This training was updated. Refresh to continue with the latest version.'},409);
      if(input.action === 'lesson') {
        if(!course.lessons.some(l=>l.id === input.lessonId)) return json({message:'Lesson not found.'},404);
        await saveLearning(w,'lesson',`${w.identity.userId}:${course.id}:${input.lessonId}`,{courseId:course.id,lessonId:input.lessonId,revision:course.revision,name:w.identity.displayName});
      } else {
        if(input.answers.length !== course.questions.length) return json({message:'Answer every question first.'},400);
        const {data,error} = await learningQuery(w).eq('kind','lesson').eq('updated_by',w.identity.userId);
        if(error || !course.lessons.every(l=>data?.some(r=>(r.payload as Record<string,unknown>).courseId === course.id && (r.payload as Record<string,unknown>).lessonId === l.id && ((r.payload as Record<string,unknown>).revision ?? '1') === course.revision))) return json({message:'Finish each lesson before the quiz.'},400);
        const result = gradeExam(course,input.answers);
        await saveLearning(w,'exam',`${w.identity.userId}:${course.id}:${crypto.randomUUID()}`,{...result,courseId:course.id,courseTitle:course.title,revision:course.revision,name:w.identity.displayName,answers:input.answers});
        return json({ok:true,result});
      }
    } else {
      const today = learningDay(w.activeLocation.timeZone ?? "America/New_York");
      if(input.date !== today) return json({message:'A new day has started. Refresh the checklist.'},409);
      if(input.action === 'tick') {
        const {data,error} = await learningQuery(w).eq('kind','template').eq('record_key',input.kind).maybeSingle();
        if(error) throw new Error('Could not load checklist.');
        const template = data ? checklistSchema.parse(data.payload) : starterChecklists.find(c=>c.kind === input.kind)!;
        if(!template.items.some(i=>i.id === input.itemId)) return json({message:'Checklist changed. Refresh and try again.'},409);
        await saveLearning(w,'tick',`${today}:${input.kind}:${input.itemId}`,{done:input.done,name:w.identity.displayName,date:today});
      } else await saveLearning(w,'note',`${today}:${input.kind}:${w.identity.userId}`,{text:input.text,name:w.identity.displayName,date:today});
    }
    return json({ok:true});
  } catch(error) {return json({message:error instanceof z.ZodError ? 'Check the fields and try again.' : error instanceof Error ? error.message : 'Could not save.'},error instanceof LearningAccessError?error.status:400);}
}
