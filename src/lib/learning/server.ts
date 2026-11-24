import 'server-only';
import { resolveWorkspaceSession } from '@/lib/auth/workspace-session';
import { createAdminClient } from '@/lib/supabase/admin';
import { appSurface } from '@/lib/app-surface';
import { courseSchema, type Course, type LearningRecord } from './model';
import { starterCourse } from './starter';
import type { WorkspaceContextValue } from '@/lib/auth/workspace-context';
import type { Json } from '@/types/database.generated';
export const learningHeaders = { 'Cache-Control':'private, no-store', Vary:'Cookie' };
export class LearningAccessError extends Error {
  constructor(message:string, public status:number){super(message);}
}
export const canEditLearning = (w: WorkspaceContextValue) => ['owner','admin','manager'].includes(w.role);
export async function learningWorkspace() {
  if(appSurface !== 'operations') throw new LearningAccessError('Not available on this workspace.',404);
  const session = await resolveWorkspaceSession();
  if(session.status !== 'ready') throw new LearningAccessError('Sign in to Operations to continue.',session.status==='unauthenticated'?401:503);
  return session.context;
}
export function learningQuery(w: WorkspaceContextValue) {
  return createAdminClient().from('team_learning_records').select('kind,record_key,payload,updated_by,updated_at').eq('organization_id',w.organization.id).eq('location_id',w.activeLocation.id);
}
export async function saveLearning(w: WorkspaceContextValue, kind: string, key: string, payload: object) {
  const result = await createAdminClient().from('team_learning_records').upsert({organization_id:w.organization.id,location_id:w.activeLocation.id,kind,record_key:key,payload:payload as Json,updated_by:w.identity.userId},{onConflict:'organization_id,location_id,kind,record_key'});
  if(result.error) throw new Error('Could not save. Try again.');
}
export async function getCourse(w: WorkspaceContextValue,id:string): Promise<Course> {
  const {data,error} = await learningQuery(w).eq('kind','course').eq('record_key',id).maybeSingle();
  if(error) throw new Error('Could not load this course.');
  if(!data && id === starterCourse.id) return starterCourse;
  return courseSchema.parse(data?.payload);
}
export function ownLearningRecords(records: LearningRecord[],w: WorkspaceContextValue) {
  return records.filter(r=>!['lesson','exam'].includes(r.kind) || r.updated_by === w.identity.userId || canEditLearning(w));
}
