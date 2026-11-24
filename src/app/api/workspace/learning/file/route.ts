import { createAdminClient } from '@/lib/supabase/admin';
import { canEditLearning, learningHeaders, learningQuery, learningWorkspace, saveLearning } from '@/lib/learning/server';
export const runtime = 'nodejs';
export async function POST(request:Request){
  if(request.headers.get('origin') !== new URL(request.url).origin) return Response.json({message:'Request not allowed.'},{status:403});
  try {
    const w = await learningWorkspace();
    if(!canEditLearning(w) || w.mode !== 'live') return Response.json({message:'Ask a manager to add material.'},{status:403});
    if(Number(request.headers.get('content-length')) > 16*1024*1024) throw new Error('Choose a PDF under 15 MB.');
    const file = (await request.formData()).get('file');
    if(!(file instanceof File) || file.size > 15*1024*1024 || file.type !== 'application/pdf') throw new Error('Choose a PDF under 15 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    if(bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('This file is not a PDF.');
    const id = crypto.randomUUID();
    const path = `${w.organization.id}/${w.activeLocation.id}/${id}.pdf`;
    const client = createAdminClient();
    const {error} = await client.storage.from('team-learning').upload(path,bytes,{contentType:'application/pdf'});
    if(error) throw new Error('Upload failed. Try again.');
    await saveLearning(w,'resource',id,{path,name:file.name.slice(0,150)});
    return Response.json({url:`/api/workspace/learning/file?id=${id}`},{headers:learningHeaders});
  } catch(error){return Response.json({message:error instanceof Error ? error.message : 'Upload failed.'},{status:400});}
}
export async function GET(request:Request){
  try{
    const w = await learningWorkspace();
    const id = new URL(request.url).searchParams.get('id');
    if(!id || !/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found',{status:404});
    const {data,error} = await learningQuery(w).eq('kind','resource').eq('record_key',id).maybeSingle();
    if(error || !data) return new Response('Not found',{status:404});
    const payload = data.payload as {path:string;name:string};
    const result = await createAdminClient().storage.from('team-learning').download(payload.path);
    if(result.error || !result.data) throw new Error('Unavailable');
    return new Response(result.data,{headers:{...learningHeaders,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Le-Yard-training.pdf"','X-Content-Type-Options':'nosniff'}});
  } catch{return new Response('Sign in to view this PDF.',{status:401});}
}
