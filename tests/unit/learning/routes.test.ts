import { beforeEach, describe, expect, it, vi } from 'vitest';
import { starterCourse } from '@/lib/learning/starter';
const mocks=vi.hoisted(()=>({workspace:vi.fn(),save:vi.fn(),course:vi.fn(),query:vi.fn()}));
vi.mock('@/lib/learning/server',()=>({
 learningHeaders:{},learningWorkspace:mocks.workspace,saveLearning:mocks.save,getCourse:mocks.course,learningQuery:mocks.query,
 canEditLearning:(w:{role:string})=>['owner','admin','manager'].includes(w.role),
 ownLearningRecords:(r:unknown)=>r,LearningAccessError:class extends Error{},
}));
import { POST } from '@/app/api/workspace/learning/route';
const w={mode:'live',role:'employee',identity:{userId:'staff-1',displayName:'Team member'},organization:{id:'org-1'},activeLocation:{id:'loc-1',timeZone:'America/New_York'}};
function request(input:object,origin='https://operations.leyardny.com'){return new Request('https://operations.leyardny.com/api/workspace/learning',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(input)});}
function query(data:unknown){const result={data,error:null};const builder={eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue(result),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};mocks.query.mockReturnValue(builder);return builder;}
beforeEach(()=>{vi.resetAllMocks();mocks.workspace.mockResolvedValue(w);mocks.save.mockResolvedValue(undefined);mocks.course.mockResolvedValue(starterCourse);});
describe('learning writes',()=>{
 it('rejects cross-origin writes before loading a session',async()=>{expect((await POST(request({action:'note'},'https://outside.example'))).status).toBe(403);expect(mocks.workspace).not.toHaveBeenCalled();});
 it('lets staff record a lesson without capability grants or approval',async()=>{const response=await POST(request({action:'lesson',courseId:'first-shift',courseRevision:'1',lessonId:'welcome'}));expect(response.status).toBe(200);expect(mocks.save).toHaveBeenCalledWith(w,'lesson','staff-1:first-shift:welcome',expect.objectContaining({revision:'1',lessonId:'welcome'}));});
 it('keeps shared training editing with management',async()=>{expect((await POST(request({action:'course',course:starterCourse}))).status).toBe(403);expect(mocks.save).not.toHaveBeenCalled();});
 it('requires completed current lessons for a quiz',async()=>{query([]);expect((await POST(request({action:'exam',courseId:'first-shift',courseRevision:'1',answers:starterCourse.questions.map(q=>q.answer)}))).status).toBe(400);expect(mocks.save).not.toHaveBeenCalled();});
 it('grades on the server and saves a separate attempt',async()=>{query(starterCourse.lessons.map(l=>({payload:{courseId:starterCourse.id,lessonId:l.id,revision:'1'}})));const response=await POST(request({action:'exam',courseId:'first-shift',courseRevision:'1',answers:starterCourse.questions.map(q=>q.answer),score:0}));expect(response.status).toBe(200);expect((await response.json()).result.score).toBe(100);expect(mocks.save).toHaveBeenCalledWith(w,'exam',expect.any(String),expect.objectContaining({score:100,passed:true,name:'Team member'}));});
 it('rejects stale dates instead of changing a previous day',async()=>{expect((await POST(request({action:'tick',kind:'opening',date:'2020-01-01',itemId:'room',done:true}))).status).toBe(409);expect(mocks.save).not.toHaveBeenCalled();});
});
