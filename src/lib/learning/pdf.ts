import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Course } from './model';
export async function coursePdf(course:Course){
 const doc=await PDFDocument.create();const regular=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const ink=rgb(.14,.19,.14),muted=rgb(.38,.43,.38),green=rgb(.25,.35,.25);
 const clean=(s:string)=>s.replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[–—]/g,'-').replace(/…/g,'...').replace(/[^\x20-\x7E\n]/g,' ');
 const wrap=(text:string,size:number,width:number)=>{const out:string[]=[];for(const paragraph of clean(text).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){const candidate=line?`${line} ${word}`:word;if(regular.widthOfTextAtSize(candidate,size)>width&&line){out.push(line);line=word;}else line=candidate;}out.push(line);}return out;};
 let page=doc.addPage([612,792]);let y=680;let number=0;
 function newPage(label:string){if(number)page=doc.addPage([612,792]);number++;y=680;page.drawText('LE YARD / TEAM LEARNING',{x:52,y:744,font:bold,size:10,color:green});page.drawLine({start:{x:52,y:724},end:{x:560,y:724},color:rgb(.85,.88,.84)});page.drawText(String(number).padStart(2,'0'),{x:540,y:34,size:10,font:regular,color:muted});page.drawText(label,{x:52,y:34,size:9,font:regular,color:muted});}
 function text(value:string,size=12,color=ink,strong=false){for(const line of wrap(value,size,508)){if(y<85)newPage(course.title);page.drawText(line,{x:52,y,font:strong?bold:regular,size,color});y-=size*1.65;}y-=10;}
 newPage('Your first shift');text(course.title,30,green,true);text(course.description,13,muted);y-=25;text('READ. RECALL. TRY IT ON SHIFT.',10,muted,true);text('Read one story at a time. Cover the page and answer the recall question in your own words. Then practice the moment with your teammate.');text('Return to Operations > Training for saved lesson progress and the final quiz.');text('Revisit the stories tomorrow and again in a week. Recalling an answer without looking is part of the practice.');
 course.lessons.forEach((lesson,i)=>{newPage(`Lesson ${i+1} / ${course.lessons.length}`);text(`STORY ${String(i+1).padStart(2,'0')}`,10,muted,true);text(lesson.title,25,green,true);text(lesson.story);y-=8;text('REMEMBER THIS',10,green,true);text(lesson.takeaway,13);text('PAUSE & RECALL',10,green,true);text(lesson.recall);});
 newPage('Final quiz');text('What would you do?',26,green,true);text('Choose one answer per question. Complete the quiz in Operations to save your result. 80% to pass. You can try again.',12,muted);
 course.questions.forEach((q,i)=>{if(y<220)newPage('Final quiz');text(`${i+1}. ${q.prompt}`,12,ink,true);q.options.forEach((o,j)=>text(`${String.fromCharCode(65+j)}. ${o}`,11,muted));});
 return doc.save();
}
