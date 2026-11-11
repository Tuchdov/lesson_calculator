# Product ideas

Ideas for products beyond the lesson calculator. These aren't planned work for this
repo (that lives in `TODOS.md`). Some could reuse its pieces: the Google Calendar
lesson data, per-student records, and WhatsApp/Make integrations.

## Monthly profit and loss from the accountant's email

Take the monthly lesson income this app already calculates and combine it with
the accountant's monthly email about approved VAT and expenses. Show the month's
profit or loss.

- **Input:** income per month from the calculator, plus VAT and expense figures
  pulled from the accountant's email (watch the inbox, extract the numbers).
- **Output:** a monthly view of income, VAT, expenses and the resulting profit or
  loss, with a trend over months.
- **Open questions:** Is the email's format stable enough to parse reliably, or
  does it need a confirm-the-numbers step? Gross or net income? Where should the
  history be stored?

## Rescheduling chatbot

A chatbot students message when they can't make a lesson or want an extra one.

1. Reads the calendar to find open slots.
2. If no open slot fits, finds a student who could swap and asks them on WhatsApp,
   then waits for their reply.
3. Once the students agree, asks the teacher for approval.
4. On approval, updates the calendar and confirms with everyone involved.

- **Key rule:** nothing changes on the calendar without the teacher's approval.
- **Open questions:** How long to wait for a reply before trying the next
  student? Who gets asked first (same lesson length, nearby time, regular
  students)? Should a cancellation that doesn't get filled be charged?

## Lesson recording, summary and structured homework

Record a lesson, summarize it, and give the student homework as a structured
plan with checkpoints.

- **Summary:** what was worked on, what improved, what still needs work.
- **Homework:** exercises split into checkpoints the student ticks off during the
  week, so progress is visible at the next lesson.
- **Configurable exercises:** the teacher keeps a library of exercises (warm-ups,
  breathing, repertoire) and picks or edits which go into each student's plan,
  rather than relying only on generated suggestions.
- **Open questions:** consent and storage for recordings (some students are
  minors); delivery channel (WhatsApp, a student page); whether the teacher
  reviews each summary before it's sent.
