import { describe, expect, it } from 'vitest';
import { courseSchema, gradeExam, learningDay, resourceUrl } from '@/lib/learning/model';
import { starterCourse, starterChecklists } from '@/lib/learning/starter';
import { coursePdf } from '@/lib/learning/pdf';
import { PDFDocument } from 'pdf-lib';
describe('team learning',()=>{
 it('requires 80% and scores the submitted answers',()=>{
  const answers=starterCourse.questions.map(q=>q.answer);
  expect(gradeExam(starterCourse,answers)).toEqual({score:100,passed:true,correct:5,total:5});
  answers[0]=(answers[0]+1)%3;expect(gradeExam(starterCourse,answers).passed).toBe(true);
  answers[1]=(answers[1]+1)%3;expect(gradeExam(starterCourse,answers).passed).toBe(false);
 });
 it('uses restaurant-local dates across midnight and daylight saving',()=>{
  expect(learningDay('America/New_York',new Date('2026-11-24T03:30:00Z'))).toBe('2026-11-23');
  expect(learningDay('America/New_York',new Date('2026-11-24T05:30:00Z'))).toBe('2026-11-24');
 });
 it('only accepts secure learning links or scoped PDF resources',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,test','http://example.com'])expect(resourceUrl.safeParse(url).success).toBe(false);
  expect(resourceUrl.safeParse('https://example.com/video').success).toBe(true);
 });
 it('rejects duplicate lesson identities and invalid correct answers',()=>{
  expect(courseSchema.safeParse({...starterCourse,lessons:[starterCourse.lessons[0],starterCourse.lessons[0]]}).success).toBe(false);
  expect(courseSchema.safeParse({...starterCourse,questions:[{...starterCourse.questions[0],answer:3}]}).success).toBe(false);
 });
 it('has separate opening and closing tasks and creates a readable storybook',async()=>{
  expect(starterChecklists.map(c=>c.kind)).toEqual(['opening','closing']);
  const bytes=await coursePdf(starterCourse);const pdf=await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(7);
 });
});
