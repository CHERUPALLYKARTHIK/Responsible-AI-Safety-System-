# Responsible & Safe AI Systems — Final Exam Practice

A mixed final-exam simulator built from the supplied course assignment bank plus additional course-based practice questions.

## Included question bank

- 178 total questions
- 141 assignment-derived questions from the supplied PDF
- 37 additional practice questions
- Single-answer MCQ, multiple-select, and numerical-answer questions
- Original assignment question and option wording is preserved in the assignment-derived records; only option order is shuffled during an exam

## Exam behavior

- 30, 50, or 75-question final exams
- Questions from all 12 weeks are mixed; week/topic labels are hidden during the exam
- Assignment questions are prioritized
- Weak weeks receive additional weight on later exams
- Recent questions are deprioritized
- Every week remains represented
- No single week can dominate the exam
- Results reveal week/topic performance, weak areas, explanations, and memory tips

## Two running modes

### 1. Local mode — works immediately

`config.js` ships with:

```js
window.APP_CONFIG = {
  mode: "local",
  supabaseUrl: "",
  supabaseAnonKey: ""
};
```

Run from this folder:

```bash
python -m http.server 8000
```

On Windows, if `python` is unavailable:

```bash
py -m http.server 8000
```

Open:

```text
http://localhost:8000
```

Local mode stores exam history and weak-week performance in the student's browser using localStorage. It does not centrally guarantee a globally unique exam across different students.

### 2. Production Supabase mode — recommended for 300+ students

This mode provides:

- centralized exam records
- globally unique exam combinations
- server-side scoring
- centralized weak-week history per browser/student ID
- adaptive future exams
- answer keys kept on the server during the live exam

#### Step A — Create a Supabase project

Create a new project at Supabase.

#### Step B — Create the database

Run these files in the Supabase SQL editor, in this order:

1. `supabase/migrations/001_schema.sql`
2. `supabase/seed.sql`

The seed inserts the complete included 178-question bank.

#### Step C — Deploy the Edge Function

Install the Supabase CLI, then from the project folder run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy exam-api --no-verify-jwt
```

The Edge Function is located at:

```text
supabase/functions/exam-api/index.ts
```

#### Step D — Configure the frontend

Edit `config.js`:

```js
window.APP_CONFIG = {
  mode: "supabase",
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY"
};
```

Do **not** put the Supabase service-role key in `config.js`. The service-role key is used only inside the server-side Edge Function environment.

#### Step E — Run locally

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

#### Step F — Deploy the frontend

The frontend is static and can be deployed to Vercel, Netlify, Cloudflare Pages, or GitHub Pages. For 300+ students, Vercel/Cloudflare Pages plus Supabase is more than sufficient for this project size.

## Important uniqueness note

The production database enforces a unique fingerprint for the **complete question set of each generated exam**. Therefore two saved exams cannot contain the exact same combination of question IDs.

With 178 total questions and hundreds of students, individual questions will naturally overlap between students. It is mathematically impossible to give 300 students 50 questions each with zero repeated individual questions unless the bank contains at least 15,000 unique questions. The system guarantees a different overall exam combination, not zero question overlap.

## Adaptive weak-week weighting

The production generator uses these approximate weights:

- 90–100%: 1.0
- 80–89%: 1.2
- 70–79%: 1.5
- 60–69%: 1.9
- below 60%: 2.4
- no history yet: 1.15

Every exam still includes all 12 weeks. Weak weeks get more of the remaining slots but do not take over the exam.

## Main files

```text
index.html
app.js
questions.js
config.js
assets/
supabase/
  migrations/001_schema.sql
  seed.sql
  functions/exam-api/index.ts
```
