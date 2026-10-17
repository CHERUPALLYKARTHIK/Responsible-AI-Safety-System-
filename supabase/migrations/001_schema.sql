-- Responsible & Safe AI Systems
-- Production schema for unique adaptive exams.

create extension if not exists pgcrypto;

create table if not exists public.questions (
  id text primary key,
  week int not null check (week between 1 and 12),
  topic text not null,
  source text not null check (source in ('assignment','new')),
  difficulty text not null,
  type text not null check (type in ('single','multi','numeric')),
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answers jsonb not null default '[]'::jsonb,
  numeric_answer double precision,
  tolerance double precision not null default 0,
  explanation text not null,
  memory_tip text not null
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  fingerprint text not null unique,
  question_count int not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  score_pct int
);
create index if not exists exams_student_created_idx on public.exams(student_id, created_at desc);

create table if not exists public.exam_questions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  position int not null,
  question_id text not null references public.questions(id),
  option_order jsonb not null default '[]'::jsonb,
  primary key (exam_id, position)
);
create index if not exists exam_questions_question_idx on public.exam_questions(question_id);

create table if not exists public.exam_answers (
  exam_id uuid not null references public.exams(id) on delete cascade,
  position int not null,
  answer jsonb,
  is_correct boolean not null,
  primary key (exam_id, position)
);

create table if not exists public.week_performance (
  student_id text not null,
  week int not null check (week between 1 and 12),
  attempts int not null default 0,
  correct_count int not null default 0,
  total_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (student_id, week)
);

-- Students never query these tables directly. The Edge Function uses the service role.
alter table public.questions enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_answers enable row level security;
alter table public.week_performance enable row level security;
