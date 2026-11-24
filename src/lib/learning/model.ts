import { z } from "zod";

export const resourceUrl = z.string().max(1500).refine(value => !value || value.startsWith('/api/workspace/learning/file?id=') || (() => { try { return new URL(value).protocol === 'https:'; } catch { return false; } })(), 'Use an https link.');
export const lessonSchema = z.object({ id: z.string().min(1).max(80), title: z.string().min(1).max(150), story: z.string().min(1).max(12000), takeaway: z.string().min(1).max(1000), recall: z.string().min(1).max(1000), resourceUrl: resourceUrl.default('') });
export const questionSchema = z.object({ prompt: z.string().min(1).max(500), options: z.array(z.string().min(1).max(300)).min(2).max(4), answer: z.number().int().min(0).max(3), explanation: z.string().min(1).max(800) }).refine(q => q.answer < q.options.length);
export const courseSchema = z.object({ revision:z.string().max(80).default('1'), id: z.string().min(1).max(80), title: z.string().min(1).max(150), description: z.string().max(600), lessons: z.array(lessonSchema).min(1).max(30), questions: z.array(questionSchema).min(1).max(20) }).refine(c => new Set(c.lessons.map(l => l.id)).size === c.lessons.length);
export type Course = z.infer<typeof courseSchema>;
export const checklistItemSchema = z.object({ id: z.string().min(1).max(80), title: z.string().min(1).max(300) });
export const checklistSchema = z.object({ kind: z.enum(['opening', 'closing']), items: z.array(checklistItemSchema).min(1).max(60) }).refine(c => new Set(c.items.map(i => i.id)).size === c.items.length);
export type Checklist = z.infer<typeof checklistSchema>;
export type LearningRecord = { kind: string; record_key: string; payload: Record<string, unknown>; updated_at: string; updated_by: string };
export function gradeExam(course: Course, answers: number[]) {
  const correct = course.questions.filter((q, i) => answers[i] === q.answer).length;
  const score = Math.round(correct / course.questions.length * 100);
  return { correct, total: course.questions.length, score, passed: score >= 80 };
}
export function learningDay(timeZone: string, date = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).format(date); }
