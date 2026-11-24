import type { Checklist, Course } from './model';
export const starterCourse: Course = {
  revision:'1', id: 'first-shift', title: 'Your first shift at Le Yard', description: 'Five small stories. One confident first shift. About 12 minutes.',
  lessons: [
    { id:'welcome', title:'The first ten seconds', story:'It is 7:15. A guest steps in, pauses by the door, and looks at the menu. You are finishing a drink. You look up, smile, and say, “Good morning. I will be right with you.”\n\nThe guest relaxes. When you are ready, you ask whether they would like a recommendation. You listen first, then offer one clear suggestion. You repeat their order before entering it.\n\nA good welcome does not need a performance. It needs someone paying attention.', takeaway:'Notice the guest. Acknowledge them. Listen, then repeat the order.', recall:'Without looking back: what three things made the guest feel welcome?', resourceUrl:'' },
    { id:'team', title:'Two people, one rhythm', story:'The counter gets busy just as a delivery arrives. Both of you reach for the same ticket while the next guest waits.\n\nYou pause for ten seconds: “I have the guests and tickets. Can you handle preparation and the delivery?” When a drink is ready, you call the order clearly. If something will take longer, you tell your teammate before promising a time.\n\nAt the next quiet moment, you reset together. A small team works best when the handoffs are clear.', takeaway:'Say who owns the next action. Share delays early. Reset during quiet moments.', recall:'A queue is building and a delivery arrives. What would you say to your teammate?', resourceUrl:'' },
    { id:'care', title:'The question you never guess', story:'A guest asks whether a sandwich is safe for their allergy. You know most of the ingredients, but you are not certain about the bread or shared equipment.\n\nYou say, “Let me check with the person preparing it.” You check the current ingredient information and the preparation setup with your lead. You explain what you can confirm and what you cannot. You never promise an allergen-free item when you cannot verify it.\n\nIf the answer is uncertain, you say so and involve your lead before taking the order.', takeaway:'Pause and verify allergies with your lead. Never guess or promise what you cannot confirm.', recall:'What would you say when you are unsure about an ingredient or shared equipment?', resourceUrl:'' },
    { id:'order', title:'One ticket, all the way through', story:'A guest orders a sandwich with a change and a coffee. You repeat the items and the change, then enter them in Square. You check that the ticket matches the order before taking payment.\n\nAt handoff, you check the ticket against the bag: correct sandwich, requested change, drink, and any needed cutlery. You call the name or order clearly.\n\nIf a payment is unclear, check its status in Square before trying again. If an item is wrong, tell your teammate and fix it with your lead. Never create a second charge just because the first screen is slow.', takeaway:'Repeat, enter, verify, then hand off. Check uncertain payments before retrying.', recall:'Before handing over a bag, what do you compare it with? What do you do if payment is unclear?', resourceUrl:'' },
    { id:'reset', title:'Leave the next shift a good start', story:'The last guest leaves. You are tired and ready to go. Instead of relying on memory, you open the closing checklist. You work through each item and tick it only after doing it.\n\nA supply is low and a piece of equipment needs attention. You leave a short handoff note and tell your lead. You follow the shop’s equipment and food-storage procedures, then check the space together.\n\nTomorrow, you start with opening: clean station, checked stock, ready equipment, and a quick plan with your teammate. The checklist is the team’s shared memory.', takeaway:'Do the task, then tick it. Flag problems and leave a clear handoff.', recall:'What would you leave for tomorrow’s team when you cannot finish a task?', resourceUrl:'' },
  ],
  questions: [
    {prompt:'A guest arrives while you are busy. What is the best first move?',options:['Wait until the drink is finished to look up','Acknowledge them warmly and say you will be right with them','Point at the menu without speaking'],answer:1,explanation:'A brief welcome lets the guest know you have noticed them.'},
    {prompt:'You are unsure whether a sandwich is safe for an allergy. You should…',options:['Guess based on the recipe you remember','Remove the visible ingredient and promise it is safe','Check current information and preparation with your lead before promising anything'],answer:2,explanation:'Ingredients and shared preparation both matter. Pause, verify, and explain uncertainty.'},
    {prompt:'Square is slow and the payment result is unclear. What next?',options:['Check the payment status before retrying','Charge again immediately','Assume the payment failed'],answer:0,explanation:'Check the original payment first to avoid a duplicate charge.'},
    {prompt:'Both teammates start the same ticket while a delivery waits. What helps?',options:['Keep going without speaking','Briefly agree who owns guests, preparation, and the delivery','Leave the delivery for the next shift'],answer:1,explanation:'Clear ownership keeps a small team moving without duplicated work.'},
    {prompt:'When should you tick a checklist item?',options:['At the beginning of the shift','When you think someone probably did it','After doing or verifying the task, with a note for any problem'],answer:2,explanation:'The checklist records real work. Tell your lead about anything that needs attention.'},
  ],
};
export const starterChecklists: Checklist[] = [
  {kind:'opening',items:[
    {id:'room',title:'Walk the room: entrance, counter, and guest area ready'},
    {id:'hygiene',title:'Wash hands and prepare a clean, stocked station'},
    {id:'equipment',title:'Check equipment and food storage using shop procedures'},
    {id:'stock',title:'Check ingredients, packaging, and today’s unavailable items'},
    {id:'square',title:'Check Square, reader, printer, and order connection'},
    {id:'plan',title:'Agree roles and the first prep priorities with your teammate'},
  ]},
  {kind:'closing',items:[
    {id:'orders',title:'Check outstanding orders and payment exceptions in Square'},
    {id:'food',title:'Store, label, and handle remaining food using shop procedures'},
    {id:'clean',title:'Clean and reset counters, tools, and guest areas'},
    {id:'waste',title:'Handle waste and leave floors and bins ready'},
    {id:'stock',title:'Record low stock, waste, and tomorrow’s prep needs'},
    {id:'equipment',title:'Close equipment using its shutdown procedure'},
    {id:'handoff',title:'Leave a handoff note and tell your lead about issues'},
    {id:'secure',title:'Complete the final room check and secure the shop'},
  ]},
];
