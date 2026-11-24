import { getCourse, learningHeaders, learningWorkspace } from '@/lib/learning/server';
import { coursePdf } from '@/lib/learning/pdf';
export async function GET(request:Request){try{const w=await learningWorkspace();const course=await getCourse(w,new URL(request.url).searchParams.get('course')||'first-shift');const bytes=await coursePdf(course);return new Response(Buffer.from(bytes),{headers:{...learningHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Le-Yard-training.pdf"'}});}catch{return new Response('Sign in to download training.',{status:401});}}
